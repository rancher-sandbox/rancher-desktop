/*
Copyright © 2026 SUSE LLC
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

package procnet

import (
	"errors"
	"fmt"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

// fakeTracker is a hand-rolled mock of tracker.Tracker that records
// every call. Add behavior is driven by a per-call queue so a test can
// stage a tracker.Add(error) followed by a tracker.Add("proxy already
// running") to exercise the partial-failure recovery path.
type fakeTracker struct {
	storage     map[string]nat.PortMap
	addBehavior []addBehavior
	addCalls    []addCall
	removeCalls []string
	// removeErr, when set, is returned by every Remove call. The
	// storage entry is still cleared, mirroring APITracker.Remove's
	// leading `defer a.portStorage.remove`.
	removeErr error
}

type addBehavior struct {
	err error
	// seedStorage models APITracker's partial-failure behavior:
	// apiForwarder.Expose succeeds and portStorage.add runs, then
	// wslProxyForwarder.Send fails and tracker.Add returns the
	// downstream error. Storage stays populated.
	seedStorage bool
}

type addCall struct {
	containerID string
	portMap     nat.PortMap
}

func newFakeTracker() *fakeTracker {
	return &fakeTracker{storage: make(map[string]nat.PortMap)}
}

func (f *fakeTracker) Get(containerID string) nat.PortMap {
	return f.storage[containerID]
}

func (f *fakeTracker) Add(containerID string, portMap nat.PortMap) error {
	f.addCalls = append(f.addCalls, addCall{containerID: containerID, portMap: portMap})
	var behavior addBehavior
	if len(f.addBehavior) > 0 {
		behavior = f.addBehavior[0]
		f.addBehavior = f.addBehavior[1:]
	}
	if behavior.err == nil || behavior.seedStorage {
		f.storage[containerID] = portMap
	}
	return behavior.err
}

func (f *fakeTracker) Remove(containerID string) error {
	f.removeCalls = append(f.removeCalls, containerID)
	delete(f.storage, containerID)
	return f.removeErr
}

func (f *fakeTracker) RemoveAll() error {
	f.storage = make(map[string]nat.PortMap)
	return nil
}

// fakeIptables is a mock iptablesRunner. Per-key error injection lets a
// test stage a transient failure followed by a recovery on the next
// tick. It models the PREROUTING rule set so a test can assert a rule
// was actually installed or removed, not just that the call happened.
//
// Idempotency divergence from production: the real
// applyLoopbackIPtablesRule (scanner_linux.go) probes
// preroutingHasLoopbackRule first and short-circuits an Append against
// an already-present rule. The fake honours every Append call and
// every Delete call. No current test exercises an Append-on-present
// sequence, but a future test that does will see two applyCall entries
// where production would see one. Add the probe to the fake before
// writing such a test.
type fakeIptables struct {
	engineManaged map[string]bool
	engineErrors  map[string]error
	applyErrors   map[string]error
	// rules models the installed PREROUTING DNAT rule set, keyed by
	// iptKey. ApplyLoopbackRule(Append) adds the key; Delete drops it.
	rules map[string]bool
	// commitOnError, keyed by applyKey, marks an ApplyLoopbackRule call
	// that returns its injected error but still mutates rules -- the
	// "iptables committed the rule yet exited non-zero" shape.
	commitOnError map[string]bool
	engineCalls   []engineCall
	applyCalls    []applyCall
}

type engineCall struct {
	proto    string
	hostPort string
}

type applyCall struct {
	proto    string
	hostPort string
	act      action
}

func newFakeIptables() *fakeIptables {
	return &fakeIptables{
		engineManaged: make(map[string]bool),
		engineErrors:  make(map[string]error),
		applyErrors:   make(map[string]error),
		rules:         make(map[string]bool),
		commitOnError: make(map[string]bool),
	}
}

func iptKey(proto, hostPort string) string {
	return proto + "/" + hostPort
}

func applyKey(proto, hostPort string, act action) string {
	return proto + "/" + hostPort + "/" + string(act)
}

func (f *fakeIptables) EngineManagesPort(proto, hostPort string) (bool, error) {
	f.engineCalls = append(f.engineCalls, engineCall{proto: proto, hostPort: hostPort})
	key := iptKey(proto, hostPort)
	if err, ok := f.engineErrors[key]; ok {
		return false, err
	}
	return f.engineManaged[key], nil
}

func (f *fakeIptables) ApplyLoopbackRule(proto, hostPort string, act action) error {
	f.applyCalls = append(f.applyCalls, applyCall{proto: proto, hostPort: hostPort, act: act})
	key := applyKey(proto, hostPort, act)
	err := f.applyErrors[key]
	if err == nil || f.commitOnError[key] {
		switch act {
		case Append:
			f.rules[iptKey(proto, hostPort)] = true
		case Delete:
			delete(f.rules, iptKey(proto, hostPort))
		}
	}
	return err
}

func makePortMap(t *testing.T) nat.PortMap {
	t.Helper()
	p, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)
	return nat.PortMap{
		p: []nat.PortBinding{{HostIP: loopbackIP, HostPort: "8080"}},
	}
}

func countApplyByAction(calls []applyCall, act action) int {
	n := 0
	for _, c := range calls {
		if c.act == act {
			n++
		}
	}
	return n
}

// TestStabilityGateDefersFirstSighting confirms the first observation
// of a port is filtered (so the OCI reservation socket cannot land a
// rogue rule).
func TestStabilityGateDefersFirstSighting(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm)

	require.Empty(t, fakeT.addCalls, "first sighting must not call tracker.Add")
	require.Empty(t, fakeIPT.applyCalls, "first sighting must not touch iptables")
}

// TestStabilityGateActsOnSecondSighting confirms a stable port reaches
// tracker.Add and the iptables Append on its second consecutive scan.
func TestStabilityGateActsOnSecondSighting(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm)
	pst.Tick(pm)

	require.Len(t, fakeT.addCalls, 1, "second sighting must call tracker.Add once")
	require.Len(t, fakeIPT.applyCalls, 1, "second sighting must append once")
	require.Equal(t, Append, fakeIPT.applyCalls[0].act)
	require.Equal(t, "tcp", fakeIPT.applyCalls[0].proto)
	require.Equal(t, "8080", fakeIPT.applyCalls[0].hostPort)
}

// TestEngineDelegationSkipsTrackerAndAppend confirms that when an
// engine chain already manages the port, procnet stays out of the way:
// no tracker.Add, no iptables Append.
func TestEngineDelegationSkipsTrackerAndAppend(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm)
	pst.Tick(pm)

	require.Empty(t, fakeT.addCalls, "engine-managed port must not be added")
	require.Equal(t, 0, countApplyByAction(fakeIPT.applyCalls, Append),
		"engine-managed port must not get a procnet PREROUTING DNAT")
}

// TestResumeOwnershipInstallsAppend is the I1 regression test.
// Scenario: tracker.Add fails on wsl-proxy.Send (partial failure
// leaves portStorage populated). The next tick's tracker.Add returns
// "proxy already running"; the synthetic ID is still in storage, so
// procnet resumes ownership. The resume path must install the iptables
// Append the partial-failure path skipped, or external traffic to the
// loopback listener never gets the loopback DNAT.
func TestResumeOwnershipInstallsAppend(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeT.addBehavior = []addBehavior{
		// Tick 2: wsl-proxy.Send fails. APITracker.Add returns the
		// wrapped wsl-proxy error; portStorage stays populated because
		// apiForwarder.Expose already succeeded.
		{err: fmt.Errorf("%w: simulated", tracker.ErrWSLProxy), seedStorage: true},
		// Tick 3: apiForwarder.Expose returns "proxy already running"
		// (gvisor-tap-vsock still holds the proxy from tick 2).
		{err: fmt.Errorf("expose api error: %s", portAlreadyExposedSubstring), seedStorage: false},
	}
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: stability gate defers
	pst.Tick(pm) // 2: tracker.Add returns wsl-proxy error; storage seeded
	require.Len(t, fakeT.addCalls, 1)
	require.Equal(t, 0, countApplyByAction(fakeIPT.applyCalls, Append),
		"failed tracker.Add must not trigger iptables Append")

	pst.Tick(pm) // 3: tracker.Add returns "proxy already running"; Get >0 → resume

	require.Len(t, fakeT.addCalls, 2, "second tick exposure attempt expected")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"I1: resume-ownership branch must install the iptables Append")
	require.Equal(t, "8080", fakeIPT.applyCalls[len(fakeIPT.applyCalls)-1].hostPort)
}

// TestAppendRetryReleasesOwnershipWhenEngineChainAppears is the I2
// regression test. Scenario: tracker.Add succeeds, iptables Append
// fails transiently (xtables-lock contention); the next tick finds the
// engine chain has installed its authoritative rule. The retry path
// must NOT reissue the PREROUTING DNAT (that recreates the original
// shadow-DNAT bug); it must release ownership to the engine.
func TestAppendRetryReleasesOwnershipWhenEngineChainAppears(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.applyErrors[applyKey("tcp", "8080", Append)] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: tracker.Add ok, Append fails → appendFailed=true
	require.Len(t, fakeT.addCalls, 1)
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"failed append should have been attempted once")

	// Between ticks 2 and 3: engine chain lands its rule; the Append
	// error clears so the buggy retry would succeed in installing a
	// rogue DNAT alongside the engine's rule.
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true
	delete(fakeIPT.applyErrors, applyKey("tcp", "8080", Append))

	pst.Tick(pm) // 3: retry path

	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"I2: append retry must not install the rule when the engine chain has taken over")
	require.Len(t, fakeT.removeCalls, 1,
		"I2: append retry must release the tracker entry when the engine chain has taken over")
}

// TestCleanupReleasesAddedOnDeleteFailure is the I3 regression test
// (cleanup-side iptables Delete failure). Scenario: a port is added,
// the listener disappears, tracker.Remove succeeds, but iptables
// Delete fails. The local marker must drop anyway so the listener can
// be re-added when it reappears.
func TestCleanupReleasesAddedOnDeleteFailure(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: added
	require.Len(t, fakeT.addCalls, 1)

	// Listener disappears; iptables Delete fails.
	fakeIPT.applyErrors[applyKey("tcp", "8080", Delete)] = errors.New("xtables lock contention")
	pst.Tick(nat.PortMap{}) // 3: cleanup; Remove ok, Delete fails
	require.Len(t, fakeT.removeCalls, 1)

	// Delete recovers; listener reappears two ticks later (stability gate).
	delete(fakeIPT.applyErrors, applyKey("tcp", "8080", Delete))
	pst.Tick(pm) // 4: reappearance, defer (not in seenLastScan)
	pst.Tick(pm) // 5: stability gate passes, re-add

	require.Len(t, fakeT.addCalls, 2,
		"I3: reappearance after Delete failure must trigger a fresh tracker.Add")
}

// TestCleanupReleasesAddedOnRemoveFailure is the I3 regression test
// (cleanup-side tracker.Remove failure). APITracker.Remove wipes
// portStorage via a leading defer even when it returns an error, so a
// retry is a silent no-op. The local marker must drop anyway, or the
// listener can never be re-added when it reappears.
func TestCleanupReleasesAddedOnRemoveFailure(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: added
	require.Len(t, fakeT.addCalls, 1)

	// Listener disappears; tracker.Remove fails.
	fakeT.removeErr = errors.New("unexpose api error: simulated")
	pst.Tick(nat.PortMap{}) // 3: cleanup; Remove fails
	require.Len(t, fakeT.removeCalls, 1)

	// Remove recovers; listener reappears.
	fakeT.removeErr = nil
	pst.Tick(pm) // 4: reappearance, defer
	pst.Tick(pm) // 5: stability gate passes, re-add

	require.Len(t, fakeT.addCalls, 2,
		"I3: reappearance after tracker.Remove failure must trigger a fresh tracker.Add")
}

// TestAddErrorLoggedSuppressesLogSpam confirms the first failed
// tracker.Add for a port is logged loudly and subsequent failures are
// suppressed (Round 2 S4 resolution); a successful add clears the
// suppression so a later regression cycle gets a fresh loud first
// error. We verify the bookkeeping through the addErrorLogged field
// rather than scraping log output.
func TestAddErrorLoggedSuppressesLogSpam(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeT.addBehavior = []addBehavior{
		{err: errors.New("transient")},
		{err: errors.New("transient")},
	}
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: tracker.Add fails → addErrorLogged set
	require.True(t, pst.addErrorLogged[pPort], "first failure must record suppression marker")

	pst.Tick(pm) // 3: still failing; marker stays set
	require.True(t, pst.addErrorLogged[pPort], "subsequent failures must keep suppression set")
	require.Len(t, fakeT.addCalls, 2, "tracker.Add should have been retried on tick 3")

	// Listener disappears; the suppression marker is cleaned up so a
	// future re-add starts with a fresh loud first error.
	pst.Tick(nat.PortMap{})
	require.False(t, pst.addErrorLogged[pPort], "marker must clear when port disappears")
}

// TestOneTickListenerNeverActedOn confirms a listener present for a
// single tick (the OCI createRuntime reservation socket shape) never
// reaches tracker.Add or iptables -- the whole point of the gate.
func TestOneTickListenerNeverActedOn(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm)            // 1: first sighting, defer
	pst.Tick(nat.PortMap{}) // 2: gone before the second sighting

	require.Empty(t, fakeT.addCalls, "one-tick listener must never reach tracker.Add")
	require.Empty(t, fakeIPT.applyCalls, "one-tick listener must never touch iptables")
}

// TestStableAddedPortIsIdempotent confirms that once a healthy port is
// added, later ticks observing the same port are a no-op: tracker.Add
// and the iptables Append each run exactly once.
func TestStableAddedPortIsIdempotent(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: added
	pst.Tick(pm) // 3: alreadyAdded, appendFailed=false → no-op
	pst.Tick(pm) // 4: same

	require.Len(t, fakeT.addCalls, 1, "stable port must call tracker.Add exactly once")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"stable port must append exactly once")
}

// TestExposeEngineProbeErrorDefers confirms a transient engine-chain
// probe error in the first-add path defers the port without recording
// state, and the next tick retries cleanly.
func TestExposeEngineProbeErrorDefers(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.engineErrors[iptKey("tcp", "8080")] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: engine probe errors → defer
	require.Empty(t, fakeT.addCalls, "probe error must not reach tracker.Add")
	_, recorded := pst.added[pPort]
	require.False(t, recorded, "probe error must not record port state")

	delete(fakeIPT.engineErrors, iptKey("tcp", "8080"))
	pst.Tick(pm) // 3: probe succeeds → add
	require.Len(t, fakeT.addCalls, 1, "next tick must retry after a transient probe error")
}

// TestProbeErrorDoesNotMuteFirstAddError confirms the engine-chain probe
// and tracker.Add keep independent log-once markers: a transient probe
// failure sets probeErrorLogged, not addErrorLogged, so it cannot
// suppress the loud first log of a later tracker.Add failure.
func TestProbeErrorDoesNotMuteFirstAddError(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.engineErrors[iptKey("tcp", "8080")] = errors.New("xtables lock contention")
	fakeT.addBehavior = []addBehavior{
		{err: errors.New("transient add failure")},
	}
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: engine probe errors → probeErrorLogged set
	require.True(t, pst.probeErrorLogged[pPort], "probe failure must set probeErrorLogged")
	require.False(t, pst.addErrorLogged[pPort], "probe failure must not touch addErrorLogged")

	// Probe recovers; tracker.Add now fails. The first Add failure must
	// land on a clear addErrorLogged marker (loud first log), not be
	// muted by the earlier probe failure.
	delete(fakeIPT.engineErrors, iptKey("tcp", "8080"))
	pst.Tick(pm) // 3: probe ok → probeErrorLogged cleared; Add fails → addErrorLogged set
	require.False(t, pst.probeErrorLogged[pPort], "probe success must clear probeErrorLogged")
	require.True(t, pst.addErrorLogged[pPort], "first Add failure must set addErrorLogged")
}

// TestProxyAlreadyRunningWithoutOwnershipDelegates is the other half of
// the "proxy already running" classification. When tracker.Get returns
// nothing, the engine owns the entry under its container ID; procnet
// must delegate, not resume ownership.
func TestProxyAlreadyRunningWithoutOwnershipDelegates(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	// The engine's events handler added the port first under its
	// container ID; our synthetic Add loses the race and portStorage
	// is NOT seeded for the synthetic ID.
	fakeT.addBehavior = []addBehavior{
		{err: fmt.Errorf("expose api error: %s", portAlreadyExposedSubstring), seedStorage: false},
	}
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: tracker.Add → "proxy already running", Get==0 → delegate

	require.True(t, pst.added[pPort].delegated, "must delegate when the engine owns the entry")
	require.Equal(t, 0, countApplyByAction(fakeIPT.applyCalls, Append),
		"delegated port must not get a procnet PREROUTING DNAT")
}

// TestAddErrorClearedOnSuccessfulAdd confirms the log-suppression marker
// drops once tracker.Add finally succeeds, so a later failure cycle
// gets a fresh loud first error.
func TestAddErrorClearedOnSuccessfulAdd(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeT.addBehavior = []addBehavior{
		{err: errors.New("transient")},
		// the next tick's Add call uses the zero addBehavior → success
	}
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: tracker.Add fails → marker set
	require.True(t, pst.addErrorLogged[pPort])

	pst.Tick(pm) // 3: tracker.Add succeeds → marker cleared
	require.False(t, pst.addErrorLogged[pPort], "successful add must clear the suppression marker")
	require.False(t, pst.added[pPort].delegated)
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append))
}

// TestAppendRetrySucceedsClearsFlag confirms a transient Append failure
// records appendFailed=true, and a successful retry clears it without
// reissuing tracker.Add.
func TestAppendRetrySucceedsClearsFlag(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.applyErrors[applyKey("tcp", "8080", Append)] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: add ok, Append fails → appendFailed=true
	require.True(t, pst.added[pPort].appendFailed, "transient Append failure must record appendFailed")

	delete(fakeIPT.applyErrors, applyKey("tcp", "8080", Append))
	pst.Tick(pm) // 3: retry Append succeeds

	require.False(t, pst.added[pPort].appendFailed, "successful retry must clear appendFailed")
	require.Len(t, fakeT.addCalls, 1, "retry must not reissue tracker.Add")
	require.Equal(t, 2, countApplyByAction(fakeIPT.applyCalls, Append),
		"retry must reissue only the Append")
}

// TestAppendRetryStillFailingStaysPending confirms a still-failing
// retry keeps appendFailed set for the next tick.
func TestAppendRetryStillFailingStaysPending(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.applyErrors[applyKey("tcp", "8080", Append)] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: add ok, Append fails
	pst.Tick(pm) // 3: retry still fails

	require.True(t, pst.added[pPort].appendFailed, "still-failing retry must keep appendFailed set")
	require.Len(t, fakeT.addCalls, 1)
}

// TestAppendRetryEngineProbeErrorDefers confirms a transient engine
// probe error during the Append retry leaves the port pending without
// reissuing the Append.
func TestAppendRetryEngineProbeErrorDefers(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.applyErrors[applyKey("tcp", "8080", Append)] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: add ok, Append fails → appendFailed
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append))

	fakeIPT.engineErrors[iptKey("tcp", "8080")] = errors.New("xtables lock contention")
	pst.Tick(pm) // 3: retry: engine probe errors → defer

	require.True(t, pst.added[pPort].appendFailed, "probe error during retry must keep appendFailed set")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"probe error during retry must not reissue the Append")
}

// TestDelegatedPortCleanupSkipsTrackerAndIptables confirms that when a
// delegated port's listener disappears, procnet drops only its local
// marker -- the engine owns the tracker entry and the iptables rule.
func TestDelegatedPortCleanupSkipsTrackerAndIptables(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: delegated (I1 reconciliation runs Delete; idempotent no-op when no leftover)
	require.True(t, pst.added[pPort].delegated)
	applyCallsBeforeCleanup := len(fakeIPT.applyCalls)

	pst.Tick(nat.PortMap{}) // 3: listener gone

	_, stillTracked := pst.added[pPort]
	require.False(t, stillTracked, "delegated marker must be dropped")
	require.Empty(t, fakeT.removeCalls, "delegated cleanup must not call tracker.Remove")
	require.Equal(t, applyCallsBeforeCleanup, len(fakeIPT.applyCalls),
		"delegated cleanup must make NO iptables calls")
}

// TestOwnedPortCleanupRemovesAndDeletes confirms the clean cleanup
// path: tracker.Remove and the iptables Delete both run, and the local
// marker drops.
func TestOwnedPortCleanupRemovesAndDeletes(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm)            // 1: defer
	pst.Tick(pm)            // 2: added
	pst.Tick(nat.PortMap{}) // 3: listener gone

	_, stillTracked := pst.added[pPort]
	require.False(t, stillTracked, "owned marker must drop after clean cleanup")
	require.Len(t, fakeT.removeCalls, 1, "owned cleanup must call tracker.Remove")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Delete),
		"owned cleanup must issue an iptables Delete")
}

// TestMixedBindingsOnlyLoopbackGetsRules confirms that for a port with
// both a loopback and a non-loopback binding, only the 127.0.0.1
// binding drives the engine probe and the iptables Append.
func TestMixedBindingsOnlyLoopbackGetsRules(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	p, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)
	pm := nat.PortMap{
		p: []nat.PortBinding{
			{HostIP: "0.0.0.0", HostPort: "8080"},
			{HostIP: loopbackIP, HostPort: "8080"},
		},
	}

	pst.Tick(pm)
	pst.Tick(pm)

	require.Len(t, fakeIPT.engineCalls, 1, "only the loopback binding should drive the engine probe")
	require.Equal(t, "8080", fakeIPT.engineCalls[0].hostPort)
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"only the loopback binding should get a PREROUTING DNAT")
	require.Equal(t, "8080", fakeIPT.applyCalls[0].hostPort)
}

// TestAppendRetryEngineTakeoverDeletesCommittedRule is the I2 regression
// test. Scenario: tracker.Add succeeds, the iptables Append returns an
// error but still commits the rule (iptables committed, exited
// non-zero), so appendFailed=true with a rule actually installed. The
// next tick finds the engine chain has taken over. The retry path must
// Delete the committed procnet rule -- leaving it would shadow the
// engine's now-authoritative chain, the exact bug this package fixes.
func TestAppendRetryEngineTakeoverDeletesCommittedRule(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	// The Append errors but commits the rule.
	fakeIPT.applyErrors[applyKey("tcp", "8080", Append)] = errors.New("iptables exited non-zero")
	fakeIPT.commitOnError[applyKey("tcp", "8080", Append)] = true
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: tracker.Add ok, Append errors but commits → appendFailed=true
	require.Len(t, fakeT.addCalls, 1)
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"the commit-but-errored Append must leave the rule installed")

	// The engine chain lands its authoritative rule before tick 3.
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true

	pst.Tick(pm) // 3: retry path → engine takeover

	require.Len(t, fakeT.removeCalls, 1,
		"I2: engine takeover must release the tracker entry")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Delete),
		"I2: engine takeover must Delete the committed procnet rule")
	require.False(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"I2: the shadowing procnet rule must be gone after engine takeover")
}

// TestAppendRetryEngineTakeoverRetriesFailedDelete confirms that when
// the engine-takeover cleanup Delete fails transiently, the port stays
// appendFailed and keeps its tracker entry so the next tick re-enters
// retryAppend and re-attempts the Delete. The tracker entry must not be
// released until the Delete succeeds: releasing the proxy first would
// strand the port with neither a working proxy nor a deleted rule.
func TestAppendRetryEngineTakeoverRetriesFailedDelete(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	// The Append errors but commits the rule.
	fakeIPT.applyErrors[applyKey("tcp", "8080", Append)] = errors.New("iptables exited non-zero")
	fakeIPT.commitOnError[applyKey("tcp", "8080", Append)] = true
	// The engine-takeover cleanup Delete fails transiently.
	fakeIPT.applyErrors[applyKey("tcp", "8080", Delete)] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: tracker.Add ok, Append errors but commits → appendFailed=true
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"the commit-but-errored Append must leave the rule installed")

	// The engine chain lands its authoritative rule before tick 3.
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true

	pst.Tick(pm) // 3: retry path → engine takeover, but the Delete fails
	require.Empty(t, fakeT.removeCalls,
		"the tracker entry must not be released until the Delete succeeds")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"a failed Delete must leave the committed rule in place")

	// The Delete recovers; the port must still be appendFailed so the
	// next tick re-enters retryAppend and re-attempts the Delete.
	delete(fakeIPT.applyErrors, applyKey("tcp", "8080", Delete))
	pst.Tick(pm) // 4: retry path re-enters → Delete succeeds, then Remove
	require.Len(t, fakeT.removeCalls, 1,
		"the tracker entry is released once the Delete succeeds")
	require.GreaterOrEqual(t, countApplyByAction(fakeIPT.applyCalls, Delete), 2,
		"the Delete must be retried after the transient failure")
	require.False(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"the retried Delete must remove the shadowing procnet rule")
}

// TestRemoveFailureRetainsRuleForReappearance is the I1 regression test.
// Scenario: an owned port's listener disappears and tracker.Remove
// fails -- the host-switch proxy may still be bound. The loopback rule
// must be retained, not deleted: when the listener reappears,
// tracker.Add returns "proxy already running" from the stale proxy and
// (storage having been cleared) the port is delegated with no fresh
// Append, so only the retained rule keeps it reachable from the host.
func TestRemoveFailureRetainsRuleForReappearance(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	pPort, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: defer
	pst.Tick(pm) // 2: added; loopback rule installed
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")])

	// Listener disappears; tracker.Remove fails (unexpose API error).
	fakeT.removeErr = errors.New("unexpose api error: simulated")
	pst.Tick(nat.PortMap{}) // 3: cleanup; Remove fails → rule retained
	require.Len(t, fakeT.removeCalls, 1)
	require.Equal(t, 0, countApplyByAction(fakeIPT.applyCalls, Delete),
		"I1: a failed Remove must not delete the loopback rule")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"I1: the loopback rule must survive a failed Remove")

	// Listener reappears; tracker.Add returns "proxy already running"
	// from the stale proxy, with storage empty (cleared by Remove).
	fakeT.removeErr = nil
	fakeT.addBehavior = []addBehavior{
		{err: fmt.Errorf("expose api error: %s", portAlreadyExposedSubstring), seedStorage: false},
	}
	pst.Tick(pm) // 4: reappearance, defer
	pst.Tick(pm) // 5: tracker.Add → "proxy already running", Get==0 → delegate

	require.True(t, pst.added[pPort].delegated,
		"I1: reappearing port with a stale proxy must delegate")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Append),
		"I1: the reappearing port gets no fresh Append")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"I1: the retained rule keeps the reappearing port reachable")
}

// TestRemoveFailureClassificationDrivesRuleCleanup confirms retireDisappeared
// keys the loopback-rule Delete off the shape of the tracker.Remove failure:
// a wsl-proxy-only failure means every host-switch Unexpose landed and the
// proxy is gone, so the rule must be deleted (a retained rule pointing at a
// dead proxy would shadow a later bridge publish of the same host port); an
// unexpose failure, a combined failure, or an unclassified error all leave
// the proxy possibly bound, so the rule must be retained.
func TestRemoveFailureClassificationDrivesRuleCleanup(t *testing.T) {
	// addAndDisappear drives a port to owned-stable, then makes its
	// listener disappear with the given tracker.Remove error, and returns
	// whether the loopback rule survived the cleanup tick.
	addAndDisappear := func(t *testing.T, removeErr error) bool {
		t.Helper()
		fakeT := newFakeTracker()
		fakeIPT := newFakeIptables()
		pst := newPortStateTracker(fakeT, fakeIPT)
		pm := makePortMap(t)

		pst.Tick(pm) // 1: defer
		pst.Tick(pm) // 2: added; loopback rule installed
		require.True(t, fakeIPT.rules[iptKey("tcp", "8080")])

		fakeT.removeErr = removeErr
		pst.Tick(nat.PortMap{}) // 3: listener gone
		require.Len(t, fakeT.removeCalls, 1)
		return fakeIPT.rules[iptKey("tcp", "8080")]
	}

	t.Run("wsl-proxy-only failure deletes the rule", func(t *testing.T) {
		survived := addAndDisappear(t, fmt.Errorf("%w: simulated", tracker.ErrWSLProxy))
		require.False(t, survived,
			"S1: a wsl-proxy-only Remove failure must delete the orphaned loopback rule")
	})

	t.Run("unexpose failure retains the rule", func(t *testing.T) {
		survived := addAndDisappear(t, fmt.Errorf("%w: simulated", forwarder.ErrUnexposeAPI))
		require.True(t, survived,
			"S1: an unexpose failure may leave the proxy bound, so the rule must stay")
	})

	t.Run("combined failure retains the rule", func(t *testing.T) {
		survived := addAndDisappear(t, errors.Join(
			fmt.Errorf("%w: simulated", forwarder.ErrUnexposeAPI),
			fmt.Errorf("%w: simulated", tracker.ErrWSLProxy)))
		require.True(t, survived,
			"S1: a combined failure means an Unexpose may not have landed, so keep the rule")
	})

	t.Run("unclassified failure retains the rule", func(t *testing.T) {
		survived := addAndDisappear(t, errors.New("unclassified remove error"))
		require.True(t, survived,
			"S1: an unclassified Remove error must keep the rule (conservative default)")
	})
}

// TestEngineDelegationReleasesPriorPartialAdd is the I3 regression test.
// Scenario: tracker.Add returns a wsl-proxy.Send error with portStorage
// populated (the partial-failure shape); the port stays out of pst.added.
// Before the next tick, the engine chain appears. exposeNew runs again
// and the `if managed` branch must release the synthetic procnet
// ownership before delegating; otherwise the gvisor-tap-vsock proxy
// stays bound under the synthetic ID forever, blocking the engine's
// later Add with "proxy already running".
func TestEngineDelegationReleasesPriorPartialAdd(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeT.addBehavior = []addBehavior{
		// Tick 2: wsl-proxy.Send fails after apiForwarder.Expose succeeded;
		// portStorage[synthetic] populated.
		{err: fmt.Errorf("%w: simulated", tracker.ErrWSLProxy), seedStorage: true},
	}
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	port, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)
	syntheticID := syntheticIDFor(port)

	pst.Tick(pm) // 1: stability gate defers
	pst.Tick(pm) // 2: tracker.Add returns wsl-proxy error; storage seeded
	require.Len(t, fakeT.addCalls, 1)
	require.NotNil(t, fakeT.storage[syntheticID],
		"partial Add must leave portStorage populated under the synthetic ID")
	require.NotContains(t, pst.added, port,
		"failed Add must NOT record state in pst.added")

	// Between ticks 2 and 3: engine chain lands.
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true

	pst.Tick(pm) // 3: exposeNew re-runs; engine probe true; must release synthetic ownership

	require.True(t, pst.added[port].delegated,
		"I3: port must end up delegated after engine takeover")
	require.Contains(t, fakeT.removeCalls, syntheticID,
		"I3: engine-delegation branch must release procnet's prior partial-Add ownership via tracker.Remove")
	require.Nil(t, fakeT.storage[syntheticID],
		"I3: synthetic portStorage entry must be cleared after release")
}

// TestEngineDelegationAcceptsLeakWhenRemoveFails locks the documented
// trade-off in exposeNew's engine-delegation branch: when the
// partial-Add's host-switch unexpose fails (Remove returns an
// ErrUnexposeAPI-shaped error), the gvisor proxy may still be bound
// under the synthetic ID. The branch logs at Error and marks the port
// delegated anyway because APITracker.Remove clears portStorage via a
// leading defer, so a next-tick retry would see an empty portMap, skip
// the Unexpose loop, and silently return nil -- hiding the failure
// rather than recovering. The same trade-off applies in retryAppend's
// engine-takeover branch and in retireDisappeared's default case.
//
// For a HostIP=127.0.0.1 publish this trade-off has a known cost: the
// engine's events handler may have already attempted its own Add,
// gotten "proxy already running" from gvisor against our 127.0.0.1
// binding, and logged once without retrying. The engine then has no
// proxy; procnet's Remove failed; nothing rebinds. Windows-side
// traffic drops until RD restart. Triggers require the 127.0.0.1-
// publish form plus stability-gate bypass plus an unexpose transient
// -- documented in the if-managed branch comment.
func TestEngineDelegationAcceptsLeakWhenRemoveFails(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	fakeT.addBehavior = []addBehavior{
		{err: fmt.Errorf("%w: simulated", tracker.ErrWSLProxy), seedStorage: true},
	}
	// The Remove on the next tick fails with an unexpose-shaped error,
	// signalling that the host-switch proxy may still be bound.
	fakeT.removeErr = fmt.Errorf("%w: unexpose api failed: simulated", forwarder.ErrUnexposeAPI)
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	port, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)
	syntheticID := syntheticIDFor(port)

	pst.Tick(pm) // 1: stability gate defers
	pst.Tick(pm) // 2: partial Add; storage seeded; pst.added stays empty
	require.NotContains(t, pst.added, port)

	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true

	pst.Tick(pm) // 3: engine chain present; Remove called; Remove fails

	require.Contains(t, fakeT.removeCalls, syntheticID,
		"engine delegation must call Remove even though it will fail")
	require.True(t, pst.added[port].delegated,
		"port must still be marked delegated despite Remove failure -- the documented trade-off")
}

// TestRemoveReportedProxyDestroyed is the I2/S3 regression test for the
// shared error-classification predicate. retireDisappeared,
// retryAppend's engine-takeover, and exposeNew's engine-delegation
// branches all decide whether a tracker.Remove error indicates the
// host-switch proxy is gone (safe to drop the rule or mark delegated)
// or may still be bound (the rare leak retireDisappeared's default
// branch already accepts). The three sites share this helper to keep
// the classification in one place; if the predicate ever drifts (e.g.,
// a future change drops the ErrUnexposeAPI side of the conjunction),
// the surface bug returns silently across all three call sites.
func TestRemoveReportedProxyDestroyed(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "wsl-proxy-only failure: proxy is gone",
			err:  fmt.Errorf("%w: wsl-proxy.Send failed: simulated", tracker.ErrWSLProxy),
			want: true,
		},
		{
			name: "unexpose-only failure: proxy may still be bound",
			err:  fmt.Errorf("%w: unexpose api failed: simulated", forwarder.ErrUnexposeAPI),
			want: false,
		},
		{
			name: "both failed: proxy may still be bound",
			err: errors.Join(
				fmt.Errorf("%w: unexpose api failed: simulated", forwarder.ErrUnexposeAPI),
				fmt.Errorf("%w: wsl-proxy.Send failed: simulated", tracker.ErrWSLProxy),
			),
			want: false,
		},
		{
			name: "unclassified error: pessimistic (may still be bound)",
			err:  errors.New("some other failure"),
			want: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, removeReportedProxyDestroyed(tc.err))
		})
	}
}

// TestEngineDelegationReconcilesLeftoverProcnetRule is the I1 regression
// test. Scenario: a procnet PREROUTING DNAT survives in the WSL2 distro
// from a prior guestagent session (iptables state persists across
// guestagent restarts; only a WSL2 distro shutdown clears it). The
// engine then republishes the same host port in the current session;
// exposeNew sees the engine chain, takes the delegation branch, and
// must Delete the leftover procnet rule before marking the port
// delegated. Without the Delete, the leftover rule terminates
// PREROUTING on iptables-nft and shadows CNI-HOSTPORT-DNAT/DOCKER --
// the exact bug this PR was created to fix.
//
// The acknowledged in-session leak (a Delete failure that has no
// retry, scanner_linux.go) feeds the same gap whenever the engine
// later republishes the port, so this Delete also catches that case.
func TestEngineDelegationReconcilesLeftoverProcnetRule(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	// Pre-seed iptables state: the procnet rule survives from a prior
	// session; the engine chain is up immediately.
	fakeIPT.rules[iptKey("tcp", "8080")] = true
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	port, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: stability gate defers
	pst.Tick(pm) // 2: exposeNew; engine probe true; must Delete the leftover

	require.True(t, pst.added[port].delegated,
		"engine-managed port must end up delegated")
	require.Equal(t, 1, countApplyByAction(fakeIPT.applyCalls, Delete),
		"I1: engine-delegation must Delete the leftover procnet rule before marking delegated")
	require.False(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"I1: the leftover procnet rule must be cleared so it stops shadowing CNI-HOSTPORT-DNAT")
}

// TestEngineDelegationDeferOnLeftoverDeleteFailure confirms that when
// the leftover-rule Delete in exposeNew's engine-delegation branch
// fails transiently, the port stays out of pst.added so the next tick
// re-enters exposeNew and retries the Delete. Marking the port
// delegated with the leftover rule still installed would recreate the
// exact shadow-DNAT bug TestEngineDelegationReconcilesLeftoverProcnetRule
// guards against; this test pins the deferral as a regression gate.
func TestEngineDelegationDeferOnLeftoverDeleteFailure(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()
	// Pre-seed iptables state: leftover procnet rule + engine chain up.
	fakeIPT.rules[iptKey("tcp", "8080")] = true
	fakeIPT.engineManaged[iptKey("tcp", "8080")] = true
	// The reconciliation Delete fails transiently on tick 2.
	fakeIPT.applyErrors[applyKey("tcp", "8080", Delete)] = errors.New("xtables lock contention")
	pst := newPortStateTracker(fakeT, fakeIPT)
	pm := makePortMap(t)
	port, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)

	pst.Tick(pm) // 1: stability gate defers
	pst.Tick(pm) // 2: engine probe true; Delete fails; port must NOT be added

	_, added := pst.added[port]
	require.False(t, added,
		"port must stay out of pst.added when the leftover-rule Delete fails -- a delegated marker with the leftover rule still installed reintroduces the shadow-DNAT bug")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"the leftover procnet rule must remain installed when the Delete fails")

	// Delete recovers; the next tick must re-enter exposeNew and Delete the rule.
	delete(fakeIPT.applyErrors, applyKey("tcp", "8080", Delete))
	pst.Tick(pm) // 3: retry succeeds

	require.True(t, pst.added[port].delegated,
		"port must end up delegated once the Delete succeeds")
	require.False(t, fakeIPT.rules[iptKey("tcp", "8080")],
		"the leftover rule must be cleared by the retried Delete")
}

// TestMultiplePortsDivergingStatesStayIndependent drives three ports
// through one Tick with diverging states -- owned-stable, delegated, and
// appendFailed -- and confirms each port's transitions are handled
// independently: no port's state, tracker call, or iptables call leaks
// onto another, including across a retry tick and a partial cleanup.
func TestMultiplePortsDivergingStatesStayIndependent(t *testing.T) {
	fakeT := newFakeTracker()
	fakeIPT := newFakeIptables()

	owned, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)
	delegated, err := nat.NewPort("tcp", "8081")
	require.NoError(t, err)
	appendFailed, err := nat.NewPort("tcp", "8082")
	require.NoError(t, err)

	pm := nat.PortMap{
		owned:        []nat.PortBinding{{HostIP: loopbackIP, HostPort: "8080"}},
		delegated:    []nat.PortBinding{{HostIP: loopbackIP, HostPort: "8081"}},
		appendFailed: []nat.PortBinding{{HostIP: loopbackIP, HostPort: "8082"}},
	}
	// 8081 is engine-managed; 8082's Append fails transiently. 8080 has
	// neither, so it becomes owned-stable. addBehavior stays empty so
	// every tracker.Add succeeds regardless of map-iteration order.
	fakeIPT.engineManaged[iptKey("tcp", "8081")] = true
	fakeIPT.applyErrors[applyKey("tcp", "8082", Append)] = errors.New("xtables lock contention")

	pst := newPortStateTracker(fakeT, fakeIPT)

	pst.Tick(pm) // 1: stability gate defers all three
	require.Empty(t, fakeT.addCalls, "first sighting must not call tracker.Add")

	pst.Tick(pm) // 2: each port acts according to its own state

	require.False(t, pst.added[owned].delegated, "8080 must be owned, not delegated")
	require.False(t, pst.added[owned].appendFailed, "8080's Append succeeded")
	require.True(t, pst.added[delegated].delegated, "8081 must be delegated to the engine")
	require.False(t, pst.added[appendFailed].delegated, "8082 must be owned, not delegated")
	require.True(t, pst.added[appendFailed].appendFailed, "8082's Append failed transiently")

	require.Len(t, fakeT.addCalls, 2, "delegated port must not reach tracker.Add")
	require.Equal(t, 2, countApplyByAction(fakeIPT.applyCalls, Append),
		"only the two non-delegated ports attempt an Append")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")], "8080's loopback rule is installed")
	require.False(t, fakeIPT.rules[iptKey("tcp", "8081")], "delegated port gets no procnet rule")
	require.False(t, fakeIPT.rules[iptKey("tcp", "8082")], "8082's failed Append left no rule")

	// 8082's Append recovers before tick 3.
	delete(fakeIPT.applyErrors, applyKey("tcp", "8082", Append))
	pst.Tick(pm) // 3: only 8082 retries; 8080 and 8081 are no-ops

	require.False(t, pst.added[appendFailed].appendFailed, "8082's retry cleared appendFailed")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8082")], "8082's retry installed the rule")
	require.Len(t, fakeT.addCalls, 2, "tick 3 must not reissue tracker.Add for any port")

	// Only the delegated port disappears; the other two stay observed.
	deletesBeforeRetire := countApplyByAction(fakeIPT.applyCalls, Delete)
	pst.Tick(nat.PortMap{
		owned:        pm[owned],
		appendFailed: pm[appendFailed],
	}) // 4: 8081 retired

	_, stillTracked := pst.added[delegated]
	require.False(t, stillTracked, "disappeared delegated port must be dropped")
	require.Empty(t, fakeT.removeCalls, "delegated cleanup must not call tracker.Remove")
	require.Equal(t, deletesBeforeRetire, countApplyByAction(fakeIPT.applyCalls, Delete),
		"retiring a delegated port must not Delete any additional rule")
	require.Contains(t, pst.added, owned, "8080 must survive an unrelated port's cleanup")
	require.Contains(t, pst.added, appendFailed, "8082 must survive an unrelated port's cleanup")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8080")], "8080's rule must survive")
	require.True(t, fakeIPT.rules[iptKey("tcp", "8082")], "8082's rule must survive")
}
