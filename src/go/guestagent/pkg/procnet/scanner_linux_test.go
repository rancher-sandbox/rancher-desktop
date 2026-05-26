/*
Copyright © 2026 SUSE LLC
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
*/

package procnet

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/procnettcp"
)

// fakeTracker records Add/Remove calls keyed by the containerID the
// scanner builds from proto/port. addErr/removeErr, when non-nil, are
// returned from the corresponding call so tests can drive failure
// paths in publish.
type fakeTracker struct {
	added     []string
	removed   []string
	addErr    error
	removeErr error
}

func (t *fakeTracker) Add(id string, _ nat.PortMap) error {
	t.added = append(t.added, id)
	return t.addErr
}

func (t *fakeTracker) Remove(id string) error {
	t.removed = append(t.removed, id)
	return t.removeErr
}
func (t *fakeTracker) Get(string) nat.PortMap { return nil }
func (t *fakeTracker) RemoveAll() error       { return nil }

// fakeForwarder records the proto/port pairs the scanner asks to bind
// or release. addErr, when non-nil, is returned from Add so tests can
// drive the forwarder-failure rollback path.
type fakeForwarder struct {
	added   []string
	removed []string
	addErr  error
}

func (f *fakeForwarder) Add(_ context.Context, proto string, port uint16) error {
	f.added = append(f.added, fmt.Sprintf("%s/%d", proto, port))
	return f.addErr
}

func (f *fakeForwarder) Remove(proto string, port uint16) error {
	f.removed = append(f.removed, fmt.Sprintf("%s/%d", proto, port))
	return nil
}

func (f *fakeForwarder) Close() error { return nil }

func loopbackPortMap(t *testing.T, port int) nat.PortMap {
	t.Helper()
	p, err := nat.NewPort("tcp", fmt.Sprint(port))
	if err != nil {
		t.Fatalf("nat.NewPort: %v", err)
	}
	return nat.PortMap{p: []nat.PortBinding{{HostIP: "127.0.0.1", HostPort: fmt.Sprint(port)}}}
}

func wildcardPortMap(t *testing.T, port int) nat.PortMap {
	t.Helper()
	p, err := nat.NewPort("tcp", fmt.Sprint(port))
	if err != nil {
		t.Fatalf("nat.NewPort: %v", err)
	}
	return nat.PortMap{p: []nat.PortBinding{{HostIP: "0.0.0.0", HostPort: fmt.Sprint(port)}}}
}

func loopbackUDPPortMap(t *testing.T, port int) nat.PortMap {
	t.Helper()
	p, err := nat.NewPort("udp", fmt.Sprint(port))
	if err != nil {
		t.Fatalf("nat.NewPort: %v", err)
	}
	return nat.PortMap{p: []nat.PortBinding{{HostIP: "127.0.0.1", HostPort: fmt.Sprint(port)}}}
}

func mergeScans(scans ...nat.PortMap) nat.PortMap {
	out := nat.PortMap{}
	for _, s := range scans {
		for k, v := range s {
			out[k] = v
		}
	}
	return out
}

func TestStabilityGateSuppressesTransientPort(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	// Tick 1: port observed.
	s.Tick(loopbackPortMap(t, 8009))
	// Tick 2: port gone.
	s.Tick(nat.PortMap{})

	if len(tr.added) != 0 {
		t.Fatalf("tracker.Add called for transient port: %v", tr.added)
	}
	if len(fwd.added) != 0 {
		t.Fatalf("forwarder.Add called for transient port: %v", fwd.added)
	}
	if len(tr.removed) != 0 {
		t.Fatalf("tracker.Remove called for never-published port: %v", tr.removed)
	}
}

func TestStabilityGatePromotesPersistentPort(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackPortMap(t, 8009)
	s.Tick(scan)
	if len(tr.added) != 0 {
		t.Fatalf("tracker.Add fired on first sighting; gate failed: %v", tr.added)
	}

	s.Tick(scan)
	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add not called after second sighting: %v", tr.added)
	}
	if got, want := fwd.added, []string{"tcp/8009"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Add = %v, want %v", got, want)
	}

	// Tick 3: still there. Should not double-publish.
	s.Tick(scan)
	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add fired twice for stable port: %v", tr.added)
	}
	if len(fwd.added) != 1 {
		t.Fatalf("forwarder.Add fired twice for stable port: %v", fwd.added)
	}
}

func TestRemovalTakesEffectImmediately(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackPortMap(t, 8009)
	s.Tick(scan)
	s.Tick(scan)
	if len(tr.added) != 1 {
		t.Fatalf("expected port published after two sightings: %v", tr.added)
	}

	// Port vanishes -> remove on this tick, no second-scan delay.
	s.Tick(nat.PortMap{})
	if len(tr.removed) != 1 {
		t.Fatalf("tracker.Remove not fired immediately: %v", tr.removed)
	}
	if got, want := fwd.removed, []string{"tcp/8009"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Remove = %v, want %v", got, want)
	}
}

func TestWildcardBindingSkipsForwarder(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := wildcardPortMap(t, 8009)
	s.Tick(scan)
	s.Tick(scan)

	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add expected for wildcard binding: %v", tr.added)
	}
	if len(fwd.added) != 0 {
		t.Fatalf("forwarder.Add fired for wildcard binding: %v", fwd.added)
	}

	s.Tick(nat.PortMap{})
	if len(fwd.removed) != 0 {
		t.Fatalf("forwarder.Remove fired for wildcard binding: %v", fwd.removed)
	}
}

func TestMixedLoopbackAndWildcard(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := mergeScans(loopbackPortMap(t, 8011), wildcardPortMap(t, 8010))
	s.Tick(scan)
	s.Tick(scan)

	if len(tr.added) != 2 {
		t.Fatalf("expected two tracker.Add calls, got %v", tr.added)
	}
	if got, want := fwd.added, []string{"tcp/8011"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Add = %v, want only loopback %v", got, want)
	}
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	ac, bc := append([]string(nil), a...), append([]string(nil), b...)
	sort.Strings(ac)
	sort.Strings(bc)
	return strings.Join(ac, ",") == strings.Join(bc, ",")
}

func TestUDPListenerThroughTick(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackUDPPortMap(t, 9000)
	s.Tick(scan)
	s.Tick(scan)

	if got, want := fwd.added, []string{"udp/9000"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Add = %v, want %v", got, want)
	}
	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add = %v, want one call", tr.added)
	}
	if _, ok := s.published[mustPort(t, "udp", 9000)]; !ok {
		t.Fatal("udp port not recorded as published")
	}

	s.Tick(nat.PortMap{})
	if got, want := fwd.removed, []string{"udp/9000"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Remove = %v, want %v", got, want)
	}
}

func TestTCPAndUDPSamePort(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := mergeScans(loopbackPortMap(t, 5353), loopbackUDPPortMap(t, 5353))
	s.Tick(scan)
	s.Tick(scan)

	if got, want := fwd.added, []string{"tcp/5353", "udp/5353"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Add = %v, want %v", got, want)
	}
	if len(tr.added) != 2 {
		t.Fatalf("tracker.Add = %v, want two calls", tr.added)
	}
}

func TestPublishRetriesAfterTrackerAddFailure(t *testing.T) {
	tr := &fakeTracker{addErr: fmt.Errorf("synthetic tracker failure")}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackPortMap(t, 8009)
	s.Tick(scan)
	s.Tick(scan)
	if _, published := s.published[mustPort(t, "tcp", 8009)]; published {
		t.Fatal("port recorded as published despite tracker.Add error")
	}
	if len(fwd.added) != 0 {
		t.Fatalf("forwarder.Add called after tracker.Add error: %v", fwd.added)
	}

	tr.addErr = nil
	s.Tick(scan)
	if _, published := s.published[mustPort(t, "tcp", 8009)]; !published {
		t.Fatal("port not published after tracker.Add recovers")
	}
	if got, want := fwd.added, []string{"tcp/8009"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Add = %v, want %v", got, want)
	}
}

func TestRollbackAfterTrackerAddFailure(t *testing.T) {
	tr := &fakeTracker{addErr: fmt.Errorf("synthetic tracker failure")}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackPortMap(t, 8009)
	s.Tick(scan)
	s.Tick(scan)

	if len(tr.added) == 0 {
		t.Fatal("tracker.Add not called")
	}
	if len(tr.removed) == 0 {
		t.Fatal("tracker.Remove not called to roll back failed Add")
	}
}

func TestRollbackAfterForwarderAddFailure(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{addErr: fmt.Errorf("synthetic forwarder failure")}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackPortMap(t, 8009)
	s.Tick(scan)
	s.Tick(scan)

	if len(fwd.added) == 0 {
		t.Fatal("forwarder.Add not called")
	}
	if len(tr.removed) == 0 {
		t.Fatal("tracker.Remove not called after forwarder.Add failure")
	}
	if _, published := s.published[mustPort(t, "tcp", 8009)]; published {
		t.Fatal("port recorded as published despite forwarder.Add error")
	}
}

func TestBindingShapeChangePublishesCurrent(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	// Tick 1 sees a transient loopback listener on the port.
	s.Tick(loopbackPortMap(t, 8009))
	// Tick 2 sees the persistent listener bound to the wildcard.
	s.Tick(wildcardPortMap(t, 8009))

	if len(fwd.added) != 0 {
		t.Fatalf("forwarder.Add fired for wildcard binding promoted from loopback-pending: %v", fwd.added)
	}
	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add = %v, want one call", tr.added)
	}
}

func TestGateRestartsAfterAbsence(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	scan := loopbackPortMap(t, 8009)
	s.Tick(scan)          // pending: first sighting
	s.Tick(nat.PortMap{}) // gone before second sighting
	if len(tr.added) != 0 {
		t.Fatalf("tracker.Add fired for transient port: %v", tr.added)
	}
	s.Tick(scan) // first sighting again
	if len(tr.added) != 0 {
		t.Fatalf("gate did not restart; tracker.Add fired on first re-sighting: %v", tr.added)
	}
	s.Tick(scan) // second sighting; now publish
	if len(tr.added) != 1 {
		t.Fatalf("port not published after second sighting: %v", tr.added)
	}
}

func TestEntriesToPortMapSkipsForwarderBindIP(t *testing.T) {
	bindIP := net.ParseIP("192.168.127.2")
	s := newScanner(context.Background(), &fakeTracker{}, &fakeForwarder{}, bindIP, time.Second)

	entries := []procnettcp.Entry{
		{Kind: procnettcp.TCP, IP: net.ParseIP("127.0.0.1"), Port: 8009, State: procnettcp.TCPListen},
		{Kind: procnettcp.TCP, IP: bindIP, Port: 8009, State: procnettcp.TCPListen},
	}
	out := s.entriesToPortMap(entries)

	if len(out) != 1 {
		t.Fatalf("entriesToPortMap returned %d keys, want 1", len(out))
	}
	port := mustPort(t, "tcp", 8009)
	bindings, ok := out[port]
	if !ok {
		t.Fatalf("tcp/8009 missing from output: %v", out)
	}
	if len(bindings) != 1 || bindings[0].HostIP != "127.0.0.1" {
		t.Fatalf("bindings = %+v, want one entry with HostIP=127.0.0.1", bindings)
	}
}

func mustPort(t *testing.T, proto string, port int) nat.Port {
	t.Helper()
	p, err := nat.NewPort(proto, fmt.Sprint(port))
	if err != nil {
		t.Fatalf("nat.NewPort: %v", err)
	}
	return p
}
