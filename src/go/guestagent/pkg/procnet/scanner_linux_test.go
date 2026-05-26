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
	"io"
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

// TestMixedBindingsSkipForwarderAndKeepTracker pins the rule that
// a port carrying both a 127.0.0.1 and a 0.0.0.0 binding publishes
// through the tracker and skips forwarder.Add. The in-namespace
// wildcard listener already accepts bindIP:port, so a forwarder
// bind there would collide with EADDRINUSE; the tracker entry
// keeps Windows-side traffic reachable.
//
// fwd.addErr would force a rollback if forwarder.Add fired; the
// test asserts it does not.
func TestMixedBindingsSkipForwarderAndKeepTracker(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{addErr: fmt.Errorf("synthetic forwarder failure")}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)
	port := mustPort(t, "tcp", 8009)
	scan := nat.PortMap{port: []nat.PortBinding{
		{HostIP: "127.0.0.1", HostPort: "8009"},
		{HostIP: "0.0.0.0", HostPort: "8009"},
	}}

	s.Tick(scan)
	s.Tick(scan)

	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add = %v, want one call", tr.added)
	}
	if len(tr.removed) != 0 {
		t.Fatalf("tracker.Remove fired despite mixed-binding short-circuit: %v", tr.removed)
	}
	if len(fwd.added) != 0 {
		t.Fatalf("forwarder.Add fired for mixed bindings: %v", fwd.added)
	}
	if _, ok := s.published[port]; !ok {
		t.Fatalf("port %s not recorded as published", port)
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

// TestPublishLogOnceFlagState pins the per-port log-throttle flag the
// scanner uses to suppress error-log floods on persistent tracker.Add
// failures. The first failure for a port sets the flag; recovery
// clears it so a fresh failure logs again.
func TestPublishLogOnceFlagState(t *testing.T) {
	tr := &fakeTracker{addErr: fmt.Errorf("synthetic tracker failure")}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)
	port := mustPort(t, "tcp", 8009)
	scan := loopbackPortMap(t, 8009)

	s.Tick(scan)
	s.Tick(scan) // first publish attempt fails
	if !s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] = false after first failure; want true", port)
	}

	s.Tick(scan) // second publish attempt fails (should not re-log at Error)
	if !s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] cleared between failures; want sticky until recovery", port)
	}

	tr.addErr = nil
	s.Tick(scan) // recovery
	if s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] = true after recovery; want false", port)
	}
}

// TestPublishLogOnceFlagStateForwarderFailure pins the throttle for
// the forwarder.Add path. tracker.Add succeeds every tick, so a
// clear-on-tracker-success bug would defeat the throttle on
// persistent forwarder failures (typically EADDRINUSE against an
// in-namespace bind). The flag must stay set until the whole publish
// succeeds.
func TestPublishLogOnceFlagStateForwarderFailure(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{addErr: fmt.Errorf("synthetic forwarder failure")}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)
	port := mustPort(t, "tcp", 8009)
	scan := loopbackPortMap(t, 8009)

	s.Tick(scan)
	s.Tick(scan) // first publish attempt: forwarder.Add fails after tracker.Add succeeds
	if !s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] = false after forwarder.Add failure", port)
	}

	s.Tick(scan) // second attempt: forwarder still failing
	if !s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] cleared between forwarder failures; want sticky until recovery", port)
	}

	fwd.addErr = nil
	s.Tick(scan) // recovery: both tracker.Add and forwarder.Add succeed
	if s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] = true after recovery", port)
	}
}

// TestAddErrorLoggedSweptWhenPortVanishes pins the cleanup path: a
// port that fails to publish and then disappears from /proc/net must
// not leave a dangling addErrorLogged entry. Otherwise, the throttle
// map grows without bound under churn.
func TestAddErrorLoggedSweptWhenPortVanishes(t *testing.T) {
	tr := &fakeTracker{addErr: fmt.Errorf("synthetic")}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)
	port := mustPort(t, "tcp", 8009)

	s.Tick(loopbackPortMap(t, 8009))
	s.Tick(loopbackPortMap(t, 8009)) // publish fails; flag set
	if !s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged not set after publish failure")
	}

	s.Tick(nat.PortMap{}) // port vanishes from /proc/net
	if s.addErrorLogged[port] {
		t.Fatalf("addErrorLogged[%s] not swept after port vanished", port)
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

// TestBindingShapeChangeAfterPublishRepublishes covers a container
// restart where the port stays in /proc/net across ticks but the
// listener's bind address changes (wildcard -> loopback). Tick must
// unpublish the stale bindings and re-publish with the current ones;
// otherwise the forwarder for a freshly loopback-bound listener never
// starts and Windows-side traffic is refused.
func TestBindingShapeChangeAfterPublishRepublishes(t *testing.T) {
	tr := &fakeTracker{}
	fwd := &fakeForwarder{}
	s := newScanner(context.Background(), tr, fwd, nil, time.Second)

	// Publish the port with a wildcard binding (no forwarder).
	wildcard := wildcardPortMap(t, 8009)
	s.Tick(wildcard)
	s.Tick(wildcard)
	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add = %v, want one call after wildcard publish", tr.added)
	}
	if len(fwd.added) != 0 {
		t.Fatalf("forwarder.Add fired for wildcard binding: %v", fwd.added)
	}

	// Container restarts with a loopback bind on the same port.
	loopback := loopbackPortMap(t, 8009)
	s.Tick(loopback) // shape change observed; unpublish stale wildcard, re-pend.
	if len(tr.removed) != 1 {
		t.Fatalf("tracker.Remove = %v, want one call after shape change", tr.removed)
	}
	s.Tick(loopback) // second sighting of the new shape; publish.
	if len(tr.added) != 2 {
		t.Fatalf("tracker.Add = %v, want two calls (initial wildcard, then re-publish loopback)", tr.added)
	}
	if got, want := fwd.added, []string{"tcp/8009"}; !equalStringSlices(got, want) {
		t.Fatalf("forwarder.Add = %v, want %v for loopback re-publish", got, want)
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

// TestEndToEndForwardingThroughTick wires a real loopbackForwarder
// behind newScanner and verifies a client dial through the bindIP
// alias reaches a real upstream listener on 127.0.0.1. The other
// scanner tests use a fakeForwarder; this one closes the seam
// between scanner reconciliation and forwarder traffic delivery.
// Requires a usable 127.0.0.99 loopback alias; the test skips when
// the alias is unavailable (matching the existing forwarder tests).
func TestEndToEndForwardingThroughTick(t *testing.T) {
	upstreamPort, stopUpstream := startUpstream(t, "scanner end-to-end ok")
	defer stopUpstream()

	bindIP := net.ParseIP("127.0.0.99")
	fwd := newLoopbackForwarder(bindIP)
	defer fwd.Close()

	tr := &fakeTracker{}
	s := newScanner(context.Background(), tr, fwd, bindIP, time.Second)

	p, err := nat.NewPort("tcp", fmt.Sprint(upstreamPort))
	if err != nil {
		t.Fatalf("nat.NewPort: %v", err)
	}
	scan := nat.PortMap{p: []nat.PortBinding{{HostIP: "127.0.0.1", HostPort: fmt.Sprint(upstreamPort)}}}

	// Two Ticks promote the port through the stability gate; the
	// second opens the forwarder listener on bindIP:upstreamPort.
	s.Tick(scan)
	s.Tick(scan)
	if len(tr.added) != 1 {
		t.Fatalf("tracker.Add = %v, want one call after publish", tr.added)
	}

	conn, err := dial("tcp", fmt.Sprintf("127.0.0.99:%d", upstreamPort), 2*time.Second)
	if err != nil {
		t.Skipf("dial via 127.0.0.99 failed (loopback aliases unavailable): %v", err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	buf, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read from forwarder: %v", err)
	}
	if got, want := string(buf), "scanner end-to-end ok"; got != want {
		t.Fatalf("forwarded payload = %q, want %q", got, want)
	}
}

// TestEndToEndUDPAndRemovalThroughTick complements
// TestEndToEndForwardingThroughTick by exercising the UDP code path
// (the dial closure that captures ctx) and the unpublish path
// (vanished port -> forwarder.Remove -> bindIP:port socket closed,
// dial refused). A regression that handed a request-scoped ctx to
// forwarder.Add for UDP, or that failed to close the listener on
// removal, would not be caught by any other test in the suite.
func TestEndToEndUDPAndRemovalThroughTick(t *testing.T) {
	upstreamPort, stopUpstream := startUDPEcho(t)
	defer stopUpstream()

	bindIP := net.ParseIP("127.0.0.99")
	fwd := newLoopbackForwarder(bindIP)
	defer fwd.Close()

	tr := &fakeTracker{}
	s := newScanner(context.Background(), tr, fwd, bindIP, time.Second)

	p, err := nat.NewPort("udp", fmt.Sprint(upstreamPort))
	if err != nil {
		t.Fatalf("nat.NewPort: %v", err)
	}
	scan := nat.PortMap{p: []nat.PortBinding{{HostIP: "127.0.0.1", HostPort: fmt.Sprint(upstreamPort)}}}

	s.Tick(scan)
	s.Tick(scan) // promote past the stability gate; UDP forwarder bound

	conn, err := dial("udp", fmt.Sprintf("127.0.0.99:%d", upstreamPort), 2*time.Second)
	if err != nil {
		t.Skipf("dial via 127.0.0.99 failed (loopback aliases unavailable): %v", err)
	}
	want := "round-trip"
	if _, err := conn.Write([]byte(want)); err != nil {
		conn.Close()
		t.Fatalf("write to forwarder: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil {
		conn.Close()
		t.Fatalf("read echo: %v", err)
	}
	if got := string(buf[:n]); got != want {
		conn.Close()
		t.Fatalf("payload = %q, want %q", got, want)
	}
	conn.Close()

	// Port vanishes from /proc/net: Tick must drive forwarder.Remove,
	// closing the UDP listener. A fresh dial+write+read should fail to
	// round-trip because the forwarder no longer accepts datagrams.
	s.Tick(nat.PortMap{})
	if len(tr.removed) != 1 {
		t.Fatalf("tracker.Remove = %v, want one call after port vanished", tr.removed)
	}

	dialAfter, err := dial("udp", fmt.Sprintf("127.0.0.99:%d", upstreamPort), 500*time.Millisecond)
	if err != nil {
		// UDP dial rarely returns an error even against a closed socket;
		// the round-trip read below is the real check.
		t.Logf("dial after remove returned (acceptable): %v", err)
		return
	}
	defer dialAfter.Close()
	if _, err := dialAfter.Write([]byte("after-remove")); err != nil {
		t.Logf("write after remove failed (acceptable): %v", err)
		return
	}
	_ = dialAfter.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	buf2 := make([]byte, 1024)
	if _, err := dialAfter.Read(buf2); err == nil {
		t.Fatalf("UDP read succeeded after forwarder.Remove; want timeout or error")
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
