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
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/docker/go-connections/nat"
)

// fakeTracker records Add/Remove calls keyed by the containerID the
// scanner builds from proto/port.
type fakeTracker struct {
	added   []string
	removed []string
}

func (t *fakeTracker) Add(id string, _ nat.PortMap) error { t.added = append(t.added, id); return nil }
func (t *fakeTracker) Remove(id string) error             { t.removed = append(t.removed, id); return nil }
func (t *fakeTracker) Get(string) nat.PortMap             { return nil }
func (t *fakeTracker) RemoveAll() error                   { return nil }

// fakeForwarder records the proto/port pairs the scanner asks to bind
// or release. Stays in-process; never touches a real socket.
type fakeForwarder struct {
	added   []string
	removed []string
}

func (f *fakeForwarder) Add(_ context.Context, proto string, port uint16) error {
	f.added = append(f.added, fmt.Sprintf("%s/%d", proto, port))
	return nil
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
	s := newScanner(context.Background(), tr, fwd, time.Second)

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
	s := newScanner(context.Background(), tr, fwd, time.Second)

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
	s := newScanner(context.Background(), tr, fwd, time.Second)

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
	s := newScanner(context.Background(), tr, fwd, time.Second)

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
	s := newScanner(context.Background(), tr, fwd, time.Second)

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
