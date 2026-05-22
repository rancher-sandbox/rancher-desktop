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
)

type action string

const (
	Append action = "append"
	Delete action = "delete"
)

const routeLocalnet = "/proc/sys/net/ipv4/conf/eth0/route_localnet"

// loopbackIP is the host-local address procnet redirects --network=host
// loopback listeners to.
const loopbackIP = "127.0.0.1"

// engineDNATChains is the closed list of container-engine PREROUTING
// chains procnet probes for an existing DNAT to a host port. Adding a
// third engine (e.g. a future containerd-native portmap implementation)
// requires extending this list, or engineChainManagesPort silently
// returns false for ports the new engine handles -- recreating the
// original shadow-DNAT bug. NewProcNetScanner logs the active list at
// startup so a support-bundle reader sees what procnet considered.
var engineDNATChains = []string{"CNI-HOSTPORT-DNAT", "DOCKER"}

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
	log.Infof("/proc/net scanner probing PREROUTING chains for engine-managed ports: %s", strings.Join(engineDNATChains, ", "))
	return &ProcNetScanner{
		context:      ctx,
		tracker:      t,
		scanInterval: scanInterval,
	}, enableLocalnetRouting()
}

// ForwardPorts polls /proc/net every scanInterval and delegates each
// observation to portStateTracker.Tick. The stability gate, engine-chain
// probing, tracker accounting, and iptables management all live in
// portStateTracker; this loop only parses the procfs snapshot and drives
// the tick cadence.
//
// The two-scan stability gate inside portStateTracker filters out the
// transient reservation socket that nerdctl's OCI createRuntime hook
// opens before CNI installs its iptables rules. The gate costs one tick
// (~3 s) before genuine --network=host listeners reach the host.
// Bridge-network ports are unaffected; the containerd/docker events
// handler exposes them via tracker.Add on /tasks/start.
func (p *ProcNetScanner) ForwardPorts() error {
	ticker := time.NewTicker(p.scanInterval)
	defer ticker.Stop()

	pst := newPortStateTracker(p.tracker, &realIptablesRunner{ctx: p.context})

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
			pst.Tick(newPortMap)
		}
	}
}

// iptablesCommand builds an exec.Cmd for iptables with the locale pinned
// to C. isIptablesRuleAbsent classifies a --check or --list failure by
// substring-matching iptables' English stderr, so a localized iptables
// build must not be allowed to translate those diagnostics -- a
// translated "No chain ... by that name" would be misread as a transient
// failure and defer the port indefinitely.
func iptablesCommand(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "iptables", args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	return cmd
}

// applyLoopbackIPtablesRule appends or deletes the loopback PREROUTING
// DNAT rule for protocol/hostPort. Meaningful only for --network=host
// containers, where traffic bound to 127.0.0.1 must be redirected from
// outside the network namespace.
//
// The Append path relies on the caller (portStateTracker, via
// anyEngineBinding) having already verified that no container-engine
// chain manages the port. On iptables-nft (the default on supported
// WSL2 kernels) DNAT in PREROUTING terminates the chain, so a procnet
// rule for an engine-managed port shadows the engine's authoritative
// rule and hangs external traffic. Both the bug and the fix depend on
// this chain-terminating behavior; revisit the probes if the kernel
// default changes. The end-to-end coverage in
// bats/tests/containers/published-ports.bats exercises the live
// shadow-DNAT path but does not assert the chain-terminating behavior
// itself, so a future WSL2 kernel that ships with iptables-legacy
// defaults would silently invalidate the design's foundation: a probe
// of `iptables-save -t nat | grep '^:PREROUTING ACCEPT'` plus a
// kernel-version check in the bats setup would catch a regression.
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
// The idempotency gate shells out to real iptables, so the fake
// iptablesRunner in the unit tests cannot reach it; published-ports.bats
// covers it end to end.
//
// Example iptables rule when act is Append:
//
//	iptables -t nat -A PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
//
// Example iptables rule when act is Delete:
//
//	iptables -t nat -D PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
func applyLoopbackIPtablesRule(ctx context.Context, protocol, hostPort string, act action) error {
	exists, err := preroutingHasLoopbackRule(ctx, protocol, hostPort)
	if err != nil {
		return fmt.Errorf("iptables --check for %s/%s: %w", protocol, hostPort, err)
	}
	if act == Delete && !exists {
		log.Debugf("skipping PREROUTING DNAT delete for %s/%s: rule not present", protocol, hostPort)
		return nil
	}
	if act == Append && exists {
		log.Debugf("skipping PREROUTING DNAT append for %s/%s: rule already present", protocol, hostPort)
		return nil
	}
	// iptables -t nat --wait 2 -<A|D> PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
	iptablesCmd := iptablesCommand(ctx,
		"--wait", "2",
		"--table", "nat",
		fmt.Sprintf("--%s", act), "PREROUTING",
		"--protocol", protocol,
		"--dport", hostPort,
		"--jump", "DNAT",
		"--to-destination", fmt.Sprintf("%s:%s", loopbackIP, hostPort),
	)
	// Output() rather than Run() so a non-zero exit carries iptables'
	// stderr; the command produces no stdout worth keeping.
	if _, err := iptablesCmd.Output(); err != nil {
		return wrapExitError(err)
	}
	log.Debugf("running the following iptables rule [%s]", iptablesCmd.String())
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
	for _, chain := range engineDNATChains {
		cmd := iptablesCommand(ctx,
			"--wait", "2",
			"--table", "nat",
			"--list", chain,
			"--numeric")
		out, err := cmd.Output()
		if err != nil {
			if isIptablesRuleAbsent(err) {
				continue
			}
			return false, fmt.Errorf("iptables --list %s: %w", chain, wrapExitError(err))
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
// rule applyLoopbackIPtablesRule would Append already exists. Gates the
// Delete path so we do not log errors for rules we never wrote.
//
// Returns (false, nil) when iptables reports the rule is absent (the
// expected case when the Append was previously skipped or cleaned up
// out of band). Returns (false, err) on transient iptables failure. The
// Append path records appendFailed and retries; the Delete path has no
// retry, so a transient Delete-probe failure leaks the rule until RD
// restart.
func preroutingHasLoopbackRule(ctx context.Context, protocol, port string) (bool, error) {
	cmd := iptablesCommand(ctx,
		"--wait", "2",
		"--table", "nat",
		"--check", "PREROUTING",
		"--protocol", protocol,
		"--dport", port,
		"--jump", "DNAT",
		"--to-destination", fmt.Sprintf("%s:%s", loopbackIP, port),
	)
	// cmd.Output() so the ExitError carries stderr for isIptablesRuleAbsent.
	if _, err := cmd.Output(); err != nil {
		if isIptablesRuleAbsent(err) {
			return false, nil
		}
		return false, wrapExitError(err)
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

// wrapExitError annotates err with the stderr that exec.Cmd.Output
// captured into *exec.ExitError. iptables exits non-zero with a one-line
// diagnostic on stderr (xtables lock contention, invalid argument), but a
// bare *exec.ExitError stringifies only as "exit status N", so the
// caller's log line would otherwise lose the reason. err is returned
// unchanged when it is not an *exec.ExitError or carries no stderr.
func wrapExitError(err error) error {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
	}
	return err
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
