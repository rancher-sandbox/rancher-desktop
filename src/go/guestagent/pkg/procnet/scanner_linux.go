/*
Copyright © 2024 SUSE LLC
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/*
Package procnet provides functionality to scan and manage network ports based on the system's
/proc/net/{tcp,udp} entries. It monitors for new and removed ports and handles port forwarding
via host switch's API. Also, it creates iptables PREROUTING rules, specifically for containers
using the host network driver. This package is designed to work with the Linux-based WSL
environment, enabling localnet routing and managing port mappings.
*/
package procnet

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/procnettcp"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

type action string

const (
	Append action = "append"
	Delete action = "delete"
)

const routeLocalnet = "/proc/sys/net/ipv4/conf/eth0/route_localnet"

// portAlreadyExposedSubstring is the substring tracker.Add returns when
// another component has already exposed the port (typically the
// containerd or docker events handler on /tasks/start). The string
// originates in the /services/forwarder/expose API response and survives
// the tracker's wrapping. ForwardPorts treats this case as success: the
// engine has wired up the authoritative CNI rule, leaving procnet
// nothing to do.
const portAlreadyExposedSubstring = "proxy already running"

// portState records what procnet has done for a port currently observed
// on /proc/net.
//
//	bindings: the binding set captured at first sighting.
//	delegated: an engine owns the proxy. Set when an engine chain
//	  (CNI-HOSTPORT-DNAT or DOCKER) already references the port, OR
//	  when tracker.Add returns portAlreadyExposedSubstring against an
//	  ID procnet does not already own. The cleanup path must skip
//	  tracker.Remove in this case -- the engine owns the tracker entry
//	  under its container ID, and our synthetic ID would walk an empty
//	  portStorage entry.
//	appendFailed: a previous tick succeeded at tracker.Add but failed
//	  at execLoopbackIPtablesRule (typically xtables lock contention).
//	  The next tick retries only the iptables Append, leaving the
//	  tracker entry alone.
//
// State machine for a single port:
//
//	First sighting: defer until next tick (stability gate filters out
//	  the OCI createRuntime hook's transient reservation socket).
//	Second sighting: probe engine chain.
//	  Engine-managed: delegate (delegated=true); no tracker.Add.
//	  Not engine-managed: tracker.Add.
//	    Succeeds: Append iptables rule; record success or
//	      appendFailed=true on transient error.
//	    "proxy already running": classify via tracker.Get(synthetic).
//	      We own it: resume ownership (delegated=false, partial-failure
//	        retry path -- apiForwarder.Expose succeeded on an earlier
//	        tick but wsl-proxy.Send failed, leaving portStorage
//	        populated).
//	      Engine owns it: delegate (delegated=true).
//	    Other error: log once at Error, retry quietly next tick.
//	Listener disappears:
//	  Delegated: drop the local marker; the engine's events handler
//	    does the unexpose under its container ID.
//	  Owned: tracker.Remove + iptables Delete; retain the entry on
//	    transient Delete error so the next tick retries.
//
// The full state machine is covered end-to-end by published-ports.bats;
// a portStateTracker extraction with an injectable tracker.Tracker would
// make the transitions unit-testable.
type portState struct {
	bindings     []nat.PortBinding
	delegated    bool
	appendFailed bool
}

// dnatRuleRe matches a single DNAT rule line in `iptables --list <chain>
// --numeric` output. Capture groups: (1) protocol (tcp|udp), then ONE of
// (2) single-port `dpt:N` or (3) multiport list `dports N[,N…]`. The
// port-range form `dpts:LO:HI` is intentionally NOT matched; see
// dnatChainContainsPort for the rationale.
var dnatRuleRe = regexp.MustCompile(
	`\b(tcp|udp)\b[^\n]*?(?:dpt:([0-9]+)|dports ([0-9]+(?:,[0-9]+)*))\b`,
)

type ProcNetScanner struct {
	context       context.Context
	LocalnetRoute bool
	tracker       tracker.Tracker
	scanInterval  time.Duration
}

func NewProcNetScanner(ctx context.Context, t tracker.Tracker, scanInterval time.Duration) (*ProcNetScanner, error) {
	return &ProcNetScanner{
		context:      ctx,
		tracker:      t,
		scanInterval: scanInterval,
	}, enableLocalnetRouting()
}

func (p *ProcNetScanner) ForwardPorts() error {
	ticker := time.NewTicker(p.scanInterval)
	defer ticker.Stop()

	// seenLastScan holds the ports observed in the previous tick. The
	// stability gate exposes only ports seen in two consecutive scans,
	// filtering out the transient reservation socket that nerdctl's OCI
	// createRuntime hook opens before CNI installs its iptables rules.
	// Without the gate, the engine-chain probe below sees no rule yet,
	// the rogue PREROUTING DNAT lands, and the eventual
	// CNI-HOSTPORT-DNAT entry stays shadowed for the container's
	// lifetime.
	//
	// The gate costs one tick (~3 s) before genuine --network=host
	// listeners reach the host. Bridge-network ports are unaffected;
	// the containerd/docker events handler exposes them via tracker.Add
	// on /tasks/start. Revisit if the 3 s delay becomes a real
	// complaint -- a pid/cgroup classifier could remove the latency at
	// the cost of fragile /proc traversal (the process may exit before
	// the read, comm names drift across engine renames, and cgroup
	// inspection is the most invasive).
	//
	// See the portState type comment for the full state machine.
	// addErrorLogged drops the Errorf to Debugf after the first failed
	// tracker.Add for a port, preventing a 3-second retry-storm log
	// flood when host-switch or wsl-proxy stays down.
	var seenLastScan nat.PortMap
	added := make(map[nat.Port]portState)
	addErrorLogged := make(map[nat.Port]bool)

	for {
		select {
		case <-p.context.Done():
			return fmt.Errorf("/proc/net scanner context cancelled: %w", p.context.Err())
		case <-ticker.C:
			entries, err := procnettcp.ParseFiles()
			if err != nil {
				log.Errorf("failed to parse /proc/net/{tcp, udp} files: %s", err)
				continue
			}
			newPortMap := make(nat.PortMap)
			for _, entry := range entries {
				if err := addValidProtoEntryToPortMap(entry, newPortMap); err != nil {
					log.Errorf("failed to create portMapping for entry: %w", err)
					continue
				}
			}

			// Add ports observed in two consecutive scans (stability gate).
			for port, bindings := range newPortMap {
				if state, alreadyAdded := added[port]; alreadyAdded {
					// Retry the iptables Append for a port whose previous
					// tick failed only on the rule write. tracker.Add is
					// not reissued -- the tracker entry already exists.
					if state.appendFailed {
						if err := p.execLoopbackIPtablesRule(state.bindings, port, Append); err != nil {
							log.Debugf("/proc/net scanner retry of iptables Append for %s still failing: %s", port, err)
						} else {
							state.appendFailed = false
							added[port] = state
							log.Infof("/proc/net scanner installed deferred iptables rule for port: %s", port)
						}
					}
					continue
				}
				if _, sawLastScan := seenLastScan[port]; !sawLastScan {
					log.Debugf("/proc/net scanner deferring port %s on first sighting", port)
					continue
				}
				// Engine-chain probe before tracker.Add. When the engine
				// already manages the port (its CNI/DOCKER chain rule is
				// in place), delegate ownership entirely: skip tracker.Add
				// and the iptables Append, mark the local state delegated,
				// and let the engine's events handler own the proxy. This
				// closes the race where procnet wins tracker.Add against a
				// not-yet-fired events handler and ties the proxy lifetime
				// to /proc/net observation instead of the container's. A
				// transient probe error defers the port without orphaning
				// state.
				managed, err := p.engineManagesLoopbackBinding(port, bindings)
				if err != nil {
					log.Errorf("/proc/net scanner engine-chain probe failed for %s; deferring: %s", port, err)
					continue
				}
				if managed {
					log.Debugf("/proc/net scanner delegating port %s to engine-managed chain", port)
					added[port] = portState{bindings: bindings, delegated: true}
					delete(addErrorLogged, port)
					continue
				}
				syntheticID := utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port()))
				if err := p.tracker.Add(syntheticID, nat.PortMap{port: bindings}); err != nil {
					if strings.Contains(err.Error(), portAlreadyExposedSubstring) {
						// "proxy already running" reaches us in two shapes.
						// Genuine engine delegation: the engine's events
						// handler called tracker.Add first under its
						// container ID; gvisor-tap-vsock has the proxy and
						// our synthetic Add lost the race. Mark delegated
						// so cleanup leaves the engine's proxy alone.
						// Partial-failure retry: a prior tick succeeded at
						// apiForwarder.Expose (so gvisor-tap-vsock has the
						// proxy and portStorage[synthetic] is populated)
						// but failed downstream (typically wsl-proxy.Send).
						// The substring is the same, but we own the entry;
						// delegating would skip the cleanup we still need.
						// portStorage[synthetic] tells the two apart.
						if len(p.tracker.Get(syntheticID)) > 0 {
							log.Debugf("/proc/net scanner port %s already added by procnet; resuming ownership after partial-failure retry", port)
							added[port] = portState{bindings: bindings, delegated: false}
							delete(addErrorLogged, port)
							continue
						}
						log.Debugf("/proc/net scanner port %s already exposed elsewhere, delegating", port)
						added[port] = portState{bindings: bindings, delegated: true}
						delete(addErrorLogged, port)
						continue
					}
					if addErrorLogged[port] {
						log.Debugf("/proc/net scanner still failing to add port %s: %s", port, err)
					} else {
						log.Errorf("/proc/net scanner failed to add port: %s", err)
						addErrorLogged[port] = true
					}
					continue
				}
				delete(addErrorLogged, port)
				log.Infof("/proc/net scanner added port: %s -> %+v", port, bindings)
				appendErr := p.execLoopbackIPtablesRule(bindings, port, Append)
				if appendErr != nil {
					// Retain the entry with appendFailed=true; the next
					// tick retries only the iptables Append. Symmetric
					// with the Delete-side retry below -- a transient
					// iptables error must not silently drop the rule.
					log.Errorf("/proc/net scanner creating loopback iptable rules for portbinding: %v failed: %s", bindings, appendErr)
				}
				added[port] = portState{
					bindings:     bindings,
					delegated:    false,
					appendFailed: appendErr != nil,
				}
			}

			// Remove ports we exposed once their listener disappears.
			for port, state := range added {
				if _, exists := newPortMap[port]; exists {
					continue
				}
				if state.delegated {
					// Engine owns the tracker entry and (if present) the
					// iptables rule. Drop the local marker without touching
					// either.
					log.Debugf("/proc/net scanner cleaning up delegated port: %s", port)
					delete(added, port)
					continue
				}
				log.Infof("/proc/net scanner removed port: %s -> %+v", port, state.bindings)
				if err := p.tracker.Remove(utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port()))); err != nil {
					log.Errorf("/proc/net scanner failed to remove port: %s", err)
					continue
				}
				if err := p.execLoopbackIPtablesRule(state.bindings, port, Delete); err != nil {
					// Retain the `added` entry so we retry the iptables
					// Delete on the next tick. Without this, a transient
					// probe error leaks a real PREROUTING rule (the leak
					// self-cleans on RD restart, but is a long-lived
					// artifact otherwise).
					log.Errorf("/proc/net scanner deleting loopback iptable rules for portbinding: %v failed: %s", state.bindings, err)
					continue
				}
				delete(added, port)
			}

			// Drop log-suppression markers for ports that disappeared
			// without ever entering `added`. Their next sighting starts a
			// fresh first-error cycle.
			for port := range addErrorLogged {
				if _, exists := newPortMap[port]; !exists {
					delete(addErrorLogged, port)
				}
			}

			// newPortMap is rebuilt with make() on the next iteration, so
			// this alias is safe; do not reuse newPortMap below this line.
			seenLastScan = newPortMap
		}
	}
}

// engineManagesLoopbackBinding probes container-engine chains for any
// 127.0.0.1 binding of the port. Returns (true, nil) if any engine chain
// already manages the port (the caller must skip the procnet Append for
// that port); (false, nil) if no engine chain does; (false, err) on
// transient iptables error (the caller is expected to defer the port to
// the next scan).
func (p *ProcNetScanner) engineManagesLoopbackBinding(port nat.Port, bindings []nat.PortBinding) (bool, error) {
	for _, binding := range bindings {
		if binding.HostIP != "127.0.0.1" {
			continue
		}
		managed, err := engineChainManagesPort(p.context, port.Proto(), binding.HostPort)
		if err != nil {
			return false, fmt.Errorf("%s/%s: %w", port.Proto(), binding.HostPort, err)
		}
		if managed {
			log.Debugf("skipping PREROUTING DNAT for %s/%s: port already managed by container engine chain",
				port.Proto(), binding.HostPort)
			return true, nil
		}
	}
	return false, nil
}

// execLoopbackIPtablesRule appends or deletes the loopback PREROUTING
// DNAT rule for any 127.0.0.1 binding of the port. This function is
// only meaningful for --network=host containers, where traffic bound to
// 127.0.0.1 has to be redirected from outside the network namespace.
//
// The Append path relies on the caller (ForwardPorts, via
// engineManagesLoopbackBinding) having already verified that no
// container-engine chain manages the port. On iptables-nft (the
// default on supported WSL2 kernels) DNAT in PREROUTING terminates
// the chain, so a procnet rule for an engine-managed port shadows the
// engine's authoritative rule and hangs external traffic. Both the
// bug and the fix depend on this chain-terminating behavior; revisit
// the probes if the kernel default changes.
//
// Both paths probe preroutingHasLoopbackRule first. The Delete probe
// avoids logging spurious errors for rules we never wrote. The Append
// probe is the idempotency gate: when the rule already exists (because
// a previous tick's iptables call committed the rule but returned
// non-zero, or an external party wrote the same rule), the second
// Append would otherwise install a duplicate PREROUTING DNAT, and a
// later Delete would remove only one of the pair. Both probes return
// the probe error on transient failure so the caller can defer.
//
// Example iptables rule when 'action' is "append":
//
//	iptables -t nat -A PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
//
// Example iptables rule when 'action' is "delete":
//
//	iptables -t nat -D PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
func (p *ProcNetScanner) execLoopbackIPtablesRule(bindings []nat.PortBinding, portProto nat.Port, action action) error {
	for _, binding := range bindings {
		if binding.HostIP != "127.0.0.1" {
			continue
		}
		exists, err := preroutingHasLoopbackRule(p.context, portProto.Proto(), binding.HostPort)
		if err != nil {
			return fmt.Errorf("iptables --check for %s/%s: %w", portProto.Proto(), binding.HostPort, err)
		}
		if action == Delete && !exists {
			log.Debugf("skipping PREROUTING DNAT delete for %s/%s: rule not present",
				portProto.Proto(), binding.HostPort)
			continue
		}
		if action == Append && exists {
			log.Debugf("skipping PREROUTING DNAT append for %s/%s: rule already present",
				portProto.Proto(), binding.HostPort)
			continue
		}
		// iptables -t nat --wait 2 -<A|D> PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
		//nolint:gosec // None of the arguments are user-supplied.
		iptablesCmd := exec.CommandContext(p.context,
			"iptables",
			"--wait", "2",
			"--table", "nat",
			fmt.Sprintf("--%s", action), "PREROUTING",
			"--protocol", portProto.Proto(),
			"--dport", binding.HostPort,
			"--jump", "DNAT",
			"--to-destination", fmt.Sprintf("%s:%s", binding.HostIP, binding.HostPort),
		)
		if err := iptablesCmd.Run(); err != nil {
			return err
		}
		log.Debugf("running the following iptables rule [%s] for port bindings: %v", iptablesCmd.String(), binding)
	}
	return nil
}

// engineChainManagesPort reports whether a container-engine chain
// already references the port as a DNAT destination for protocol.
// When true, procnet must not add its own PREROUTING DNAT.
//
// The chain list is closed to the two engines Rancher Desktop ships
// (CNI-HOSTPORT-DNAT for nerdctl/CNI portmap, DOCKER for docker).
// Revisit (and update this docstring) when adding a third engine;
// otherwise the helper silently misses its DNAT rules and the original
// shadow-DNAT bug reappears.
//
// Returns (false, nil) when a chain does not exist (the engine has not
// yet created it). Returns (false, err) on transient iptables failure
// (xtables lock contention, fork/exec failure) so the caller can defer
// the port to a later scan; mirrors the precedent at
// pkg/iptables/iptables.go that treats exit status 4 as transient.
// Shells out to iptables directly; end-to-end behavior is covered by
// published-ports.bats. Distinguishing absent from transient errors
// is unit-tested through isIptablesRuleAbsent.
func engineChainManagesPort(ctx context.Context, protocol, port string) (bool, error) {
	for _, chain := range []string{"CNI-HOSTPORT-DNAT", "DOCKER"} {
		cmd := exec.CommandContext(ctx,
			"iptables",
			"--wait", "2",
			"--table", "nat",
			"--list", chain,
			"--numeric")
		out, err := cmd.Output()
		if err != nil {
			if isIptablesRuleAbsent(err) {
				continue
			}
			return false, fmt.Errorf("iptables --list %s: %w", chain, err)
		}
		if dnatChainContainsPort(string(out), protocol, port) {
			return true, nil
		}
	}
	return false, nil
}

// dnatChainContainsPort reports whether `iptables --list <chain>
// --numeric` output references port as a DNAT destination for protocol.
// It matches both the single-port form (`tcp dpt:<port>`) and the
// multiport list form (`tcp multiport dports <port>[,…]`). Word
// boundaries prevent matching `80` against `8080` or against IP-address
// octets in `to:` clauses.
//
// Limitation: port-range syntax in either form is NOT matched. The
// standalone single-rule range (`tcp dpts:LO:HI`) is ignored entirely;
// the multiport-embedded range (`multiport dports 80,1000:2000,3000`)
// is captured only up to the first colon, so individual ports listed
// before the colon match while ports inside (or after) the range are
// missed. The engines Rancher Desktop ships (nerdctl-CNI portmap and
// docker) emit per-port DNAT rules even for `-p LO-HI:LO-HI`
// publishes, so both gaps are theoretical for shipped engines but
// real for hand-rolled iptables setups that target the same chains.
// The dpts: and embedded-range fixtures in the test file lock the
// current (intentional) miss.
func dnatChainContainsPort(out, protocol, port string) bool {
	for _, m := range dnatRuleRe.FindAllStringSubmatch(out, -1) {
		if m[1] != protocol {
			continue
		}
		if m[2] != "" && m[2] == port {
			return true
		}
		if m[3] != "" {
			for _, p := range strings.Split(m[3], ",") {
				if p == port {
					return true
				}
			}
		}
	}
	return false
}

// preroutingHasLoopbackRule reports whether the exact PREROUTING DNAT
// rule execLoopbackIPtablesRule would Append already exists. Gates the
// Delete path so we do not log errors for rules we never wrote.
//
// Returns (false, nil) when iptables reports the rule is absent (the
// expected case when the Append was previously skipped or cleaned up
// out of band). Returns (false, err) on transient iptables failure so
// the caller can defer the Delete rather than dropping `added` state
// and leaking the rule until RD restart.
func preroutingHasLoopbackRule(ctx context.Context, protocol, port string) (bool, error) {
	cmd := exec.CommandContext(ctx,
		"iptables",
		"--wait", "2",
		"--table", "nat",
		"--check", "PREROUTING",
		"--protocol", protocol,
		"--dport", port,
		"--jump", "DNAT",
		"--to-destination", fmt.Sprintf("127.0.0.1:%s", port),
	)
	// cmd.Output() so the ExitError carries stderr for isIptablesRuleAbsent.
	if _, err := cmd.Output(); err != nil {
		if isIptablesRuleAbsent(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// isIptablesRuleAbsent reports whether an iptables --check or --list
// failure indicates that the rule or chain does not exist. The
// canonical iptables stderr messages we treat as "absent" are:
//
//	No chain/target/match by that name        -- chain does not exist
//	Bad rule (does a matching rule exist ...) -- rule does not exist
//
// Every other failure mode (exit status 4 from xtables lock
// contention, fork/exec failure, invalid-argument errors, etc.)
// returns false so the caller bubbles the error and defers the scan.
// "Absent" here means a steady-state "no" the caller can act on now;
// anything else might succeed on the next tick.
func isIptablesRuleAbsent(err error) bool {
	if err == nil {
		return false
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return false
	}
	stderr := string(exitErr.Stderr)
	return strings.Contains(stderr, "No chain/target/match by that name") ||
		strings.Contains(stderr, "does a matching rule exist in that chain")
}

func addValidProtoEntryToPortMap(entry procnettcp.Entry, portMap nat.PortMap) error {
	switch entry.Kind {
	case procnettcp.TCP:
		if entry.State == procnettcp.TCPListen {
			return addEntryToPortMap(entry, portMap)
		}
	case procnettcp.UDP:
		if entry.State == procnettcp.UDPEstablished {
			return addEntryToPortMap(entry, portMap)
		}
	}
	return nil
}

func addEntryToPortMap(entry procnettcp.Entry, portMap nat.PortMap) error {
	port := strconv.Itoa(int(entry.Port))
	portMapKey, err := nat.NewPort(strings.ToLower(entry.Kind), port)
	if err != nil {
		return fmt.Errorf("generating portMapKey protocol: %s, port: %d failed: %w",
			entry.Kind,
			entry.Port,
			err)
	}

	// It's important not to use entry.IP directly here, as any IP
	// other than 127.0.0.1 (localhost) or 0.0.0.0 may not be accessible
	// from the host. To ensure consistent behavior, we always set the
	// HostIP to INADDR_ANY (0.0.0.0) unless the IP is localhost or 0.0.0.0.
	// The API tracker will then adjust the address as necessary:
	// - If admin privileges are enabled, the address will remain 0.0.0.0.
	// - Otherwise, it will be changed to 127.0.0.1 to ensure proper local binding.
	var hostIP net.IP
	inAddrAny := net.IPv4(0, 0, 0, 0)
	if entry.IP.IsLoopback() || entry.IP.Equal(inAddrAny) {
		hostIP = entry.IP
	} else {
		hostIP = inAddrAny
	}
	portBinding := nat.PortBinding{
		HostIP:   hostIP.String(),
		HostPort: port,
	}
	portMap[portMapKey] = append(portMap[portMapKey], portBinding)
	return nil
}

func enableLocalnetRouting() error {
	const enable = "1"
	return writeSysctl(routeLocalnet, enable)
}

func writeSysctl(path, value string) error {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("could not open the sysctl file %s: %w", path, err)
	}
	defer f.Close()
	if _, err := f.WriteString(value); err != nil {
		return fmt.Errorf("could not write to the sysctl file %s: %w", path, err)
	}
	log.Infof("/proc/net scanner enabled %s", routeLocalnet)
	return nil
}
