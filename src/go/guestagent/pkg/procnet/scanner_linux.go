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

const loopbackIP = "127.0.0.1"

// loopbackController is what the scanner calls to manage userspace
// listeners for 127.0.0.1 ports. The real implementation opens listeners
// on bindIP; unit tests substitute a recording fake.
type loopbackController interface {
	Add(ctx context.Context, proto string, port uint16) error
	Remove(proto string, port uint16) error
	Close() error
}

type ProcNetScanner struct {
	ctx          context.Context
	tracker      tracker.Tracker
	forwarder    loopbackController
	bindIP       net.IP
	scanInterval time.Duration

	published nat.PortMap
	pending   nat.PortMap
}

func NewProcNetScanner(ctx context.Context, t tracker.Tracker, bindIP net.IP, scanInterval time.Duration) (*ProcNetScanner, error) {
	return newScanner(ctx, t, newLoopbackForwarder(bindIP), bindIP, scanInterval), nil
}

func newScanner(ctx context.Context, t tracker.Tracker, f loopbackController, bindIP net.IP, scanInterval time.Duration) *ProcNetScanner {
	return &ProcNetScanner{
		ctx:          ctx,
		tracker:      t,
		forwarder:    f,
		bindIP:       bindIP,
		scanInterval: scanInterval,
		published:    make(nat.PortMap),
		pending:      make(nat.PortMap),
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
		if _, ok := scanned[port]; ok {
			continue
		}
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

	p.pending = make(nat.PortMap)
	for port, bindings := range scanned {
		if _, ok := p.published[port]; ok {
			continue
		}
		p.pending[port] = bindings
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
		log.Errorf("/proc/net scanner failed to add %s: %s", port, err)
		if removeErr := p.tracker.Remove(id); removeErr != nil {
			log.Errorf("/proc/net scanner rollback after tracker.Add failure for %s: %s", port, removeErr)
		}
		return err
	}
	log.Infof("/proc/net scanner added port: %s -> %+v", port, bindings)

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
			log.Errorf("/proc/net scanner: loopback forwarder %s/%s: %s", port.Proto(), b.HostPort, err)
			if removeErr := p.tracker.Remove(id); removeErr != nil {
				log.Errorf("/proc/net scanner rollback after forwarder.Add failure for %s: %s", port, removeErr)
			}
			return err
		}
	}
	return nil
}

func (p *ProcNetScanner) unpublish(port nat.Port, bindings []nat.PortBinding) {
	id := utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port()))
	if err := p.tracker.Remove(id); err != nil {
		log.Errorf("/proc/net scanner failed to remove %s: %s", port, err)
	}
	log.Infof("/proc/net scanner removed port: %s -> %+v", port, bindings)

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
