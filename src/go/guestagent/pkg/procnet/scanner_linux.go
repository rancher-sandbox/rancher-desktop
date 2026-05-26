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
Package procnet scans /proc/net/{tcp,udp} for listeners the
container-engine events handler does not publish -- mainly
--network=host containers binding 127.0.0.1 -- and exposes them to
host-switch via the API tracker. For loopback listeners it also opens
a userspace forwarder on the namespace's tap IP so traffic arriving
from host-switch reaches the in-namespace 127.0.0.1 listener. A
two-scan stability gate filters out the transient reservation socket
nerdctl's OCI createRuntime hook opens before CNI installs its
iptables rules.

IPv6 limitation: the scanner reads /proc/net/{tcp,udp} only, not the
tcp6/udp6 variants. A --network=host container that listens
exclusively on [::1]:port is invisible to the scanner and is not
reachable from Windows. Containers that bind dual-stack
(e.g. [::]:port with IPV6_V6ONLY=0, the Go and Python default) are
also invisible because the socket appears only in /proc/net/tcp6.
Only listeners that bind 127.0.0.1, 0.0.0.0, or both v4 and v6
separately are reachable from Windows.
*/
package procnet

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/procnettcp"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

const (
	loopbackIP = "127.0.0.1"
	wildcardIP = "0.0.0.0"
)

// loopbackController is what the scanner calls to manage userspace
// listeners for 127.0.0.1 ports. The real implementation opens listeners
// on bindIP; unit tests substitute a recording fake.
type loopbackController interface {
	Add(ctx context.Context, proto string, port uint16) error
	Remove(proto string, port uint16) error
	Close() error
}

// ProcNetScanner polls /proc/net/{tcp,udp} and reconciles the
// observed listener set against the API tracker and a userspace
// loopback forwarder. See the package comment for the design.
type ProcNetScanner struct {
	ctx          context.Context
	tracker      tracker.Tracker
	forwarder    loopbackController
	bindIP       net.IP
	scanInterval time.Duration

	published nat.PortMap
	pending   map[nat.Port]struct{}

	// addErrorLogged throttles publish-failure logs to one Error line
	// per port; subsequent failures for the same port log at Debug
	// until the port either publishes successfully or leaves both
	// pending and published. Without this, every tick (~3s) emits two
	// Error lines per stuck port when wsl-proxy or host-switch is
	// down, drowning the log.
	addErrorLogged map[nat.Port]bool
}

// NewProcNetScanner constructs a /proc/net scanner that publishes
// the observed listeners through tracker t. For each loopback
// (127.0.0.1) binding it also opens a userspace forwarder on
// bindIP — the namespace's tap interface IP — that pipes traffic
// into 127.0.0.1. Wildcard (0.0.0.0) bindings rely on the
// engine-namespace listener to accept bindIP:port directly and
// skip the forwarder. scanInterval controls the poll cadence; the
// two-scan stability gate adds one additional cadence of delay
// before a new port is published.
func NewProcNetScanner(ctx context.Context, t tracker.Tracker, bindIP net.IP, scanInterval time.Duration) (*ProcNetScanner, error) {
	return newScanner(ctx, t, newLoopbackForwarder(bindIP), bindIP, scanInterval), nil
}

func newScanner(ctx context.Context, t tracker.Tracker, f loopbackController, bindIP net.IP, scanInterval time.Duration) *ProcNetScanner {
	return &ProcNetScanner{
		ctx:            ctx,
		tracker:        t,
		forwarder:      f,
		bindIP:         bindIP,
		scanInterval:   scanInterval,
		published:      make(nat.PortMap),
		pending:        make(map[nat.Port]struct{}),
		addErrorLogged: make(map[nat.Port]bool),
	}
}

// ForwardPorts polls /proc/net every scanInterval and drives Tick with
// each snapshot.
func (p *ProcNetScanner) ForwardPorts() error {
	ticker := time.NewTicker(p.scanInterval)
	defer ticker.Stop()
	defer p.forwarder.Close()

	for {
		select {
		case <-p.ctx.Done():
			return fmt.Errorf("/proc/net scanner context cancelled: %w", p.ctx.Err())
		case <-ticker.C:
			scanned, err := p.scanListeners()
			if err != nil {
				log.Errorf("failed to scan /proc/net: %s", err)
				continue
			}
			p.Tick(scanned)
		}
	}
}

// Tick reconciles the tracker and userspace forwarder against scanned.
//
// The two-scan stability gate defers each new port until it appears in
// two consecutive Ticks (~3 s at the default interval). The gate
// filters the transient OCI-hook reservation socket. Removals take
// effect immediately: a vanished listener is unambiguous.
func (p *ProcNetScanner) Tick(scanned nat.PortMap) {
	for port, bindings := range p.published {
		if newBindings, ok := scanned[port]; ok && bindingsEqual(bindings, newBindings) {
			continue
		}
		// Either the port vanished or its bind addresses changed
		// (container restart with a different bind). Unpublish so the
		// next tick can re-publish against the current bindings; this
		// preserves the two-scan gate semantics for the new shape.
		p.unpublish(port, bindings)
		delete(p.published, port)
	}

	for port := range p.pending {
		bindings, ok := scanned[port]
		if !ok {
			continue
		}
		if err := p.publish(port, bindings); err != nil {
			continue
		}
		p.published[port] = bindings
	}

	p.pending = make(map[nat.Port]struct{})
	for port := range scanned {
		if _, ok := p.published[port]; ok {
			continue
		}
		p.pending[port] = struct{}{}
	}

	// Drop log-throttle state for ports that have left both maps.
	// Without this sweep, a transient port that fails to publish and
	// then vanishes leaves a dangling entry, so the map grows
	// without bound under listener churn.
	for port := range p.addErrorLogged {
		if _, ok := p.pending[port]; ok {
			continue
		}
		if _, ok := p.published[port]; ok {
			continue
		}
		delete(p.addErrorLogged, port)
	}
}

// publish reports a new listener to the API tracker and opens a
// userspace forwarder for each loopback binding. It returns an error
// if either step fails after rolling back the tracker entry, so the
// caller can leave the port in pending for next-tick retry instead
// of recording it as published.
func (p *ProcNetScanner) publish(port nat.Port, bindings []nat.PortBinding) error {
	id := utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port()))
	if err := p.tracker.Add(id, nat.PortMap{port: bindings}); err != nil {
		p.logAddFailure(port, fmt.Sprintf("failed to add: %s", err))
		if removeErr := p.tracker.Remove(id); removeErr != nil {
			p.logAddFailure(port, fmt.Sprintf("rollback after tracker.Add failure: %s", removeErr))
		}
		return err
	}

	// A wildcard binding on the same port accepts traffic to bindIP:port
	// directly, and the forwarder's bind would collide with it. Skip the
	// forwarder; the tracker entry alone keeps the port reachable from
	// Windows.
	if !hasWildcardBinding(bindings) {
		for _, b := range bindings {
			if b.HostIP != loopbackIP {
				continue
			}
			portNum, err := strconv.ParseUint(b.HostPort, 10, 16)
			if err != nil {
				// b.HostPort is strconv.Itoa of a uint16 (see
				// addEntryToPortMap), so ParseUint always succeeds. If that
				// stops being true, the caller leaks a tracker entry without
				// a matching forwarder; mirror the forwarder.Add rollback
				// above.
				log.Errorf("/proc/net scanner: bad port %q: %s", b.HostPort, err)
				continue
			}
			if err := p.forwarder.Add(p.ctx, port.Proto(), uint16(portNum)); err != nil {
				p.logAddFailure(port, fmt.Sprintf("loopback forwarder %s/%s: %s", port.Proto(), b.HostPort, err))
				if removeErr := p.tracker.Remove(id); removeErr != nil {
					p.logAddFailure(port, fmt.Sprintf("rollback after forwarder.Add failure: %s", removeErr))
				}
				return err
			}
		}
	}

	// Only mark success — and only log the success Info line — once
	// the whole publish has run. Clearing addErrorLogged or logging
	// "added port" between tracker.Add and forwarder.Add lets a
	// persistent forwarder failure re-Error every tick because the
	// flag would reset on each tick's tracker.Add.
	delete(p.addErrorLogged, port)
	log.Infof("/proc/net scanner added port: %s -> %+v", port, bindings)
	return nil
}

// logAddFailure emits the first publish-failure message for port at
// Error level and subsequent messages at Debug. addErrorLogged
// resets when publish succeeds or when the sweep at the end of Tick
// observes the port has left both pending and published.
func (p *ProcNetScanner) logAddFailure(port nat.Port, msg string) {
	if p.addErrorLogged[port] {
		log.Debugf("/proc/net scanner %s: %s", port, msg)
		return
	}
	log.Errorf("/proc/net scanner %s: %s", port, msg)
	p.addErrorLogged[port] = true
}

func (p *ProcNetScanner) unpublish(port nat.Port, bindings []nat.PortBinding) {
	id := utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port()))
	if err := p.tracker.Remove(id); err != nil {
		log.Errorf("/proc/net scanner failed to remove %s: %s", port, err)
	} else {
		log.Infof("/proc/net scanner removed port: %s -> %+v", port, bindings)
	}

	for _, b := range bindings {
		if b.HostIP != loopbackIP {
			continue
		}
		portNum, err := strconv.ParseUint(b.HostPort, 10, 16)
		if err != nil {
			continue
		}
		if err := p.forwarder.Remove(port.Proto(), uint16(portNum)); err != nil {
			log.Errorf("/proc/net scanner: loopback forwarder remove %s/%s: %s", port.Proto(), b.HostPort, err)
		}
	}
}

// scanListeners parses /proc/net/{tcp,udp} into a snapshot suitable
// for Tick. See entriesToPortMap for the filter that drops the
// forwarder's own sockets.
func (p *ProcNetScanner) scanListeners() (nat.PortMap, error) {
	entries, err := procnettcp.ParseFiles()
	if err != nil {
		return nil, err
	}
	return p.entriesToPortMap(entries), nil
}

// entriesToPortMap converts procnet entries into a port map, dropping
// any entry whose IP matches bindIP. The forwarder opens its own
// socket on bindIP for every loopback port it proxies; leaving those
// entries in the snapshot keeps the proto/port key alive after the
// upstream listener exits and blocks unpublish.
//
// Trade-off: a container that binds explicitly to bindIP (the
// namespace's tap interface IP) is filtered out alongside the
// forwarder's own listeners and never reaches publish. No container
// engine we ship does this -- host-network containers bind to
// 127.0.0.1 or 0.0.0.0, and bridge-network containers do not see
// bindIP -- so the gap is acceptable. A tighter filter would require
// procnettcp to expose inode-level ownership so the forwarder's
// sockets can be identified without overlap.
func (p *ProcNetScanner) entriesToPortMap(entries []procnettcp.Entry) nat.PortMap {
	out := make(nat.PortMap)
	for _, entry := range entries {
		if entry.IP.Equal(p.bindIP) {
			continue
		}
		if err := addValidProtoEntryToPortMap(entry, out); err != nil {
			log.Errorf("failed to create portMapping for entry: %s", err)
		}
	}
	return out
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
			entry.Kind, entry.Port, err)
	}

	// Listeners on non-loopback, non-wildcard addresses (e.g. 192.168.x.y)
	// are not reachable from the Windows host as-is. Coerce to 0.0.0.0 so
	// the tracker can decide between 0.0.0.0 and 127.0.0.1 based on the
	// admin-install flag.
	var hostIP net.IP
	inAddrAny := net.IPv4(0, 0, 0, 0)
	if entry.IP.IsLoopback() || entry.IP.Equal(inAddrAny) {
		hostIP = entry.IP
	} else {
		hostIP = inAddrAny
	}
	portMap[portMapKey] = append(portMap[portMapKey], nat.PortBinding{
		HostIP:   hostIP.String(),
		HostPort: port,
	})
	return nil
}

// hasWildcardBinding reports whether bindings holds a 0.0.0.0 entry.
// A wildcard listener inside the engine namespace already accepts
// traffic on every IP in that namespace, including bindIP, so opening
// a forwarder on bindIP:port would just duplicate the wildcard's
// claim and fail with EADDRINUSE.
func hasWildcardBinding(bindings []nat.PortBinding) bool {
	for _, b := range bindings {
		if b.HostIP == wildcardIP {
			return true
		}
	}
	return false
}

// bindingsEqual reports whether two binding lists hold the same set
// of (HostIP, HostPort) pairs. Order does not matter, but duplicates
// must match in multiplicity so a list with two identical entries
// does not compare equal to one with a single entry.
func bindingsEqual(a, b []nat.PortBinding) bool {
	if len(a) != len(b) {
		return false
	}
	counts := make(map[nat.PortBinding]int, len(a))
	for _, x := range a {
		counts[x]++
	}
	for _, x := range b {
		counts[x]--
		if counts[x] < 0 {
			return false
		}
	}
	return true
}
