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
	"context"
	"errors"
	"fmt"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

// portState records what procnet has done for a port currently observed
// on /proc/net.
//
//	bindings: the binding set captured when the port was first acted
//	  on (its second sighting -- the first only defers).
//	delegated: an engine owns the proxy. Set when an engine chain
//	  (CNI-HOSTPORT-DNAT or DOCKER) already references the port, OR
//	  when tracker.Add returns tracker.ErrPortAlreadyExposed against
//	  an ID procnet does not already own. The cleanup path must skip
//	  tracker.Remove in this case -- the engine owns the tracker entry
//	  under its container ID, and our synthetic ID would walk an empty
//	  portStorage entry.
//	appendFailed: a previous tick succeeded at tracker.Add but failed
//	  at applyLoopbackIPtablesRule (typically xtables lock contention).
//	  The next tick retries the iptables Append, or releases ownership
//	  if the engine chain has appeared since (see "Append retry" below).
//
// State machine for a single port:
//
//	First sighting: defer until next tick (stability gate filters out
//	  the OCI createRuntime hook's transient reservation socket).
//	Second sighting: probe engine chain.
//	  Engine-managed: delegate (delegated=true); no tracker.Add. Before
//	    marking delegated:
//	      1. When procnet already holds the synthetic tracker entry (a
//	         prior tick's partial Add populated portStorage before
//	         failing at wsl-proxy.Send), release ownership via
//	         tracker.Remove -- otherwise the host-switch proxy stays
//	         bound under the synthetic ID and blocks the engine's later
//	         Add with "proxy already running" until RD restart.
//	      2. Reconcile any leftover procnet loopback rule via
//	         applyLoopbackRules(Delete). The rule survives across
//	         guestagent restarts (iptables state lives in the WSL2
//	         distro) and can also leak in-session because the Delete
//	         path has no retry. On iptables-nft a leftover terminates
//	         PREROUTING and shadows CNI-HOSTPORT-DNAT/DOCKER. Defer on
//	         probe failure -- the iptables state is not cleared by any
//	         defer, so a next-tick retry recovers.
//	  Not engine-managed: tracker.Add.
//	    Succeeds: Append iptables rule; record success or
//	      appendFailed=true on transient error.
//	    tracker.ErrPortAlreadyExposed: classify via tracker.Get(synthetic).
//	      We own it: install the iptables rule that the partial-failure
//	        path skipped, mark delegated=false. apiForwarder.Expose
//	        succeeded on an earlier tick but wsl-proxy.Send failed,
//	        leaving portStorage populated; the wsl-proxy failure is not
//	        retried here (Tracker does not expose an idempotent
//	        re-notify hook).
//	      Engine owns it: delegate (delegated=true).
//	    Other error: log once at Error, retry quietly next tick.
//	Append retry (appendFailed): re-probe the engine chain.
//	  Engine chain appeared: release ownership -- delete any committed
//	    procnet rule first, then tracker.Remove, then delegate. The
//	    Delete precedes the Remove so a transient Delete failure leaves
//	    the port appendFailed with its tracker entry intact, to retry
//	    next tick, rather than stranded with neither proxy nor rule.
//	    The Remove error is classified the same way retireDisappeared
//	    classifies it: a wsl-proxy-only failure leaves the proxy gone
//	    (mark delegated); any other failure is logged and the port is
//	    still marked delegated, accepting the rare leak that
//	    retireDisappeared's default branch already accepts -- a retry
//	    would not recover because APITracker.Remove clears portStorage
//	    via a leading defer.
//	    This trusts the engine to expose the port itself. The engine
//	    chain is installed during container network setup, before the
//	    engine's portTracker.Add runs, so its presence does not prove
//	    the engine holds a host-switch proxy. If the engine's Add raced
//	    procnet's and lost, it got tracker.ErrPortAlreadyExposed and
//	    recorded nothing, and the port keeps no host-switch proxy until
//	    RD restart. The retry path only runs once the stability gate
//	    was bypassed under heavy load, so this rides along with that
//	    documented limitation.
//	  Still not engine-managed: retry the iptables Append only.
//	Listener disappears:
//	  Delegated: drop the local marker; the engine's events handler
//	    does the unexpose under its container ID.
//	  Owned: tracker.Remove. On success -- or a wsl-proxy-only
//	    failure, where every host-switch Unexpose landed and the proxy
//	    is gone -- delete the loopback rule. On an unexpose failure the
//	    proxy may still be bound, so keep the rule -- deleting it would
//	    strand traffic to the proxy, and a retained rule self-cleans on
//	    RD restart. Either way drop the local marker: APITracker.Remove
//	    wipes portStorage via a leading defer, so retrying it on a later
//	    tick is a silent no-op, and retaining the marker deadlocks
//	    the Add path if the listener reappears.
//
// Bindings refresh: state.bindings is captured at the second-sighting
// tick (or at handleAlreadyExposed's resume path) and is not refreshed
// when later ticks observe a different binding set for the same
// nat.Port. Consequence: a --network=host process that opens
// 127.0.0.1:hostPort AFTER a non-loopback listener on the same hostPort
// has been acted on misses the PREROUTING DNAT, and external traffic to
// that loopback-only listener is dropped until the port retires and
// reappears. The symmetric direction is benign: a loopback rule already
// in place stays installed, and a 0.0.0.0 listener catches the
// redirected traffic on its own.
//
// Engine-chain re-probe: addObserved re-probes the engine chain only
// when appendFailed=true; owned-success and delegated ports skip
// re-evaluation until they retire and reappear. Two consequences: a
// delegated port whose engine chain disappears stays delegated --
// procnet never installs the loopback DNAT, and external traffic to a
// 127.0.0.1-only listener is dropped; an owned port whose engine later
// installs a CNI/DOCKER rule keeps procnet's PREROUTING DNAT in place,
// reintroducing the shadow-DNAT bug along this ordering path. Both
// require a mid-lifecycle change in the engine chain; chain setup and
// teardown normally align with listener appearance and disappearance,
// which the stability gate and retire path already handle.
type portState struct {
	bindings     []nat.PortBinding
	delegated    bool
	appendFailed bool
}

// iptablesRunner abstracts the iptables operations the state machine
// depends on, so tests can inject a fake.
type iptablesRunner interface {
	// EngineManagesPort reports whether a container-engine chain
	// (CNI-HOSTPORT-DNAT or DOCKER) already references the port as a
	// DNAT destination.
	EngineManagesPort(proto, hostPort string) (bool, error)

	// ApplyLoopbackRule appends or deletes the PREROUTING DNAT loopback
	// rule for proto/hostPort, idempotency-probed against the existing
	// rule state.
	ApplyLoopbackRule(proto, hostPort string, act action) error
}

// realIptablesRunner shells out to iptables for production.
type realIptablesRunner struct {
	ctx context.Context
}

func (r *realIptablesRunner) EngineManagesPort(proto, hostPort string) (bool, error) {
	return engineChainManagesPort(r.ctx, proto, hostPort)
}

func (r *realIptablesRunner) ApplyLoopbackRule(proto, hostPort string, act action) error {
	return applyLoopbackIPtablesRule(r.ctx, proto, hostPort, act)
}

// portStateTracker drives the procnet per-port state machine across
// scan ticks. State (added, seenLastScan, addErrorLogged,
// probeErrorLogged) outlives a single Tick call. The struct is not
// safe for concurrent use; callers must serialize Tick.
type portStateTracker struct {
	tracker          tracker.Tracker
	iptables         iptablesRunner
	added            map[nat.Port]portState
	seenLastScan     nat.PortMap
	addErrorLogged   map[nat.Port]bool
	probeErrorLogged map[nat.Port]bool
}

func newPortStateTracker(t tracker.Tracker, ipt iptablesRunner) *portStateTracker {
	// seenLastScan is intentionally left nil: Tick wholesale-replaces it
	// every call, and a nil-map read on the first tick correctly reports
	// every port as a first sighting.
	return &portStateTracker{
		tracker:          t,
		iptables:         ipt,
		added:            make(map[nat.Port]portState),
		addErrorLogged:   make(map[nat.Port]bool),
		probeErrorLogged: make(map[nat.Port]bool),
	}
}

// Tick runs one scan iteration: expose newly-observed ports, retire
// ports whose listeners disappeared, and refresh the stability gate.
func (pst *portStateTracker) Tick(newPortMap nat.PortMap) {
	pst.addObserved(newPortMap)
	pst.retireDisappeared(newPortMap)
	pst.cleanupErrorLogged(newPortMap)
	// newPortMap is rebuilt by the caller on the next iteration, so
	// this alias is safe; the caller must not mutate newPortMap after
	// passing it in.
	pst.seenLastScan = newPortMap
}

func (pst *portStateTracker) addObserved(newPortMap nat.PortMap) {
	for port, bindings := range newPortMap {
		if state, alreadyAdded := pst.added[port]; alreadyAdded {
			if state.appendFailed {
				pst.retryAppend(port, state)
			}
			continue
		}
		if _, sawLastScan := pst.seenLastScan[port]; !sawLastScan {
			log.Debugf("/proc/net scanner deferring port %s on first sighting", port)
			continue
		}
		pst.exposeNew(port, bindings)
	}
}

func (pst *portStateTracker) exposeNew(port nat.Port, bindings []nat.PortBinding) {
	// Engine-chain probe before tracker.Add. When the engine already
	// manages the port (its CNI/DOCKER chain rule is in place), delegate
	// ownership entirely: skip tracker.Add and the iptables Append, mark
	// the local state delegated, and let the engine's events handler own
	// the proxy. A transient probe error defers the port without
	// orphaning state.
	managed, err := pst.anyEngineBinding(port, bindings)
	if err != nil {
		if pst.probeErrorLogged[port] {
			log.Debugf("/proc/net scanner engine-chain probe still failing for %s: %s", port, err)
		} else {
			log.Errorf("/proc/net scanner engine-chain probe failed for %s; deferring: %s", port, err)
			pst.probeErrorLogged[port] = true
		}
		return
	}
	// The probe succeeded; reset its log-once marker so a later probe
	// failure logs loudly again. tracker.Add keeps a separate
	// addErrorLogged marker, so a prior probe failure never mutes the
	// first Add failure.
	delete(pst.probeErrorLogged, port)
	syntheticID := syntheticIDFor(port)
	if managed {
		// Release any prior partial-Add ownership before handing the
		// port to the engine. tracker.Add can populate
		// portStorage[synthetic] before returning a wsl-proxy.Send
		// error (see APITracker.Add's partial-failure block); without
		// this release the gvisor proxy stays bound under the synthetic
		// ID and blocks the engine's own Add with "proxy already
		// running" until RD restart. APITracker.Remove clears
		// portStorage via a leading defer, so we cannot retry: a
		// wsl-proxy-only failure means the proxy is gone, and any
		// other failure leaves the leak retireDisappeared's default
		// branch already accepts. Mark delegated either way; the
		// engine's container-start handler is expected to bind its own
		// proxy under the container ID, and the chain appearing is the
		// engine's signal that setup is underway.
		//
		// Known trade-off: when procnet's and the engine's host-switch
		// Local strings collide, the engine's events handler
		// (containerd/events_linux.go and docker/events.go) may have
		// already attempted its Add, gotten "proxy already running"
		// from gvisor against our binding, logged once, and returned
		// -- without retrying. The Remove here then tears down the
		// only host-switch proxy, and Windows-side traffic drops until
		// RD restart. The collision triggers in two configurations:
		// any HostIP=127.0.0.1 publish (procnet binds 127.0.0.1 for
		// loopback listeners; the engine's Expose also uses 127.0.0.1
		// for that publish form), and -- in non-admin install -- any
		// publish at all, since APITracker.determineHostIP rewrites
		// every HostIP to 127.0.0.1 when isAdmin is false. The trade-
		// off is intentional: leaving the synthetic entry in place
		// would strand the gvisor proxy under the synthetic ID, with
		// the engine's later Add forever failing with "proxy already
		// running", so this regression rides along with the existing
		// rare-leak path retireDisappeared's default branch already
		// accepts. The trigger still requires
		// stability-gate bypass under heavy load plus a transient
		// wsl-proxy.Send failure, and the collision configuration
		// above. The same trade-off applies in retryAppend's engine-
		// takeover branch and in retireDisappeared's default branch.
		//
		// The Get+Remove pair is non-atomic but safe: engines key
		// portStorage on container.ID and procnet keys on
		// syntheticIDFor(port), so an engine cannot Remove our entry
		// out from under us between the two calls.
		if len(pst.tracker.Get(syntheticID)) > 0 {
			if err := pst.tracker.Remove(syntheticID); err != nil {
				if removeReportedProxyDestroyed(err) {
					log.Errorf("/proc/net scanner released prior partial-Add of %s before engine delegation (wsl-proxy notification failed): %s", port, err)
				} else {
					log.Errorf("/proc/net scanner failed to release prior partial-Add of %s before engine delegation; host-switch unexpose may have left the proxy bound until RD restart: %s", port, err)
				}
			}
		}
		// Reconcile any leftover procnet loopback rule before delegating.
		// Two scenarios produce a stale rule that the delegation path
		// would otherwise leave in place: a prior guestagent session
		// installed the rule and the WSL2 distro stayed up across the
		// restart (the iptables table survives, so procnet sees nothing
		// in pst.added but the kernel still routes via the old rule);
		// or an in-session Delete failure left the rule behind because
		// the Delete path has no retry (scanner_linux.go documents this
		// leak in retireDisappeared). In either case the leftover rule
		// terminates PREROUTING on iptables-nft and shadows the engine's
		// CNI-HOSTPORT-DNAT/DOCKER chain -- the exact bug this PR fixes.
		// ApplyLoopbackRule probes preroutingHasLoopbackRule first, so
		// the call is a cheap no-op when no leftover exists. A probe
		// failure (xtables lock contention, fork/exec failure) is the
		// same kernel condition that can produce the original Delete
		// leak, so defer rather than mark delegated with a possibly-stale
		// rule: the port stays out of pst.added and the next tick
		// retries this reconciliation. Unlike the host-switch-proxy leak
		// in the tracker.Remove branch above, iptables state is not
		// cleared by any defer, so the retry actually recovers.
		if err := pst.applyLoopbackRules(bindings, port, Delete); err != nil {
			log.Debugf("/proc/net scanner reconciling leftover loopback rule for %s before engine delegation failed; deferring to next tick: %s", port, err)
			return
		}
		log.Debugf("/proc/net scanner delegating port %s to engine-managed chain", port)
		pst.added[port] = portState{bindings: bindings, delegated: true}
		delete(pst.addErrorLogged, port)
		return
	}
	if err := pst.tracker.Add(syntheticID, nat.PortMap{port: bindings}); err != nil {
		if errors.Is(err, tracker.ErrPortAlreadyExposed) {
			pst.handleAlreadyExposed(port, bindings, syntheticID)
			return
		}
		if pst.addErrorLogged[port] {
			log.Debugf("/proc/net scanner still failing to add port %s: %s", port, err)
		} else {
			log.Errorf("/proc/net scanner failed to add port: %s", err)
			pst.addErrorLogged[port] = true
		}
		return
	}
	delete(pst.addErrorLogged, port)
	log.Infof("/proc/net scanner added port: %s -> %+v", port, bindings)
	appendErr := pst.applyLoopbackRules(bindings, port, Append)
	if appendErr != nil {
		// Retain the entry with appendFailed=true; the next tick runs
		// retryAppend. Symmetric with the Delete-side behavior in
		// retireDisappeared.
		log.Errorf("/proc/net scanner creating loopback iptable rules for portbinding: %v failed: %s", bindings, appendErr)
	}
	pst.added[port] = portState{
		bindings:     bindings,
		delegated:    false,
		appendFailed: appendErr != nil,
	}
}

// handleAlreadyExposed disambiguates the two shapes of
// tracker.ErrPortAlreadyExposed from tracker.Add:
//
//	Genuine engine delegation: the engine's events handler called
//	  tracker.Add first under its container ID. gvisor-tap-vsock has
//	  the proxy and our synthetic Add lost the race. Mark delegated so
//	  cleanup leaves the engine's proxy alone.
//
//	Partial-failure retry: a prior tick succeeded at apiForwarder.Expose
//	  (so gvisor-tap-vsock has the proxy and portStorage[synthetic] is
//	  populated) but failed downstream (typically wsl-proxy.Send).
//	  The sentinel is the same, but we own the entry; install the
//	  iptables rule that the partial-failure path skipped and resume
//	  ownership.
func (pst *portStateTracker) handleAlreadyExposed(port nat.Port, bindings []nat.PortBinding, syntheticID string) {
	if len(pst.tracker.Get(syntheticID)) > 0 {
		log.Debugf("/proc/net scanner port %s already added by procnet; resuming ownership after partial-failure retry", port)
		appendErr := pst.applyLoopbackRules(bindings, port, Append)
		if appendErr != nil {
			log.Errorf("/proc/net scanner creating loopback iptable rules on resume for portbinding: %v failed: %s", bindings, appendErr)
		}
		pst.added[port] = portState{
			bindings:     bindings,
			delegated:    false,
			appendFailed: appendErr != nil,
		}
		delete(pst.addErrorLogged, port)
		return
	}
	// Do not reconcile a leftover loopback rule here. From this branch
	// the rule's origin is ambiguous: it may be a cross-session leftover
	// that shadows the engine (calling for Delete), OR it may be a
	// deliberately retained rule from this session's Remove failure on
	// Unexpose, where retireDisappeared kept it so traffic still reaches
	// the possibly-bound proxy (TestRemoveFailureRetainsRuleForReappearance).
	// Deleting in this branch would strand the same-session-reappearance
	// case; keeping it leaves the rare cross-session shadow that requires
	// guestagent crash + WSL2 distro still up. The leftover-rule
	// reconciliation in exposeNew's if-managed branch covers the common
	// cross-session case (engine chain visible to the probe).
	log.Debugf("/proc/net scanner port %s already exposed elsewhere, delegating", port)
	pst.added[port] = portState{bindings: bindings, delegated: true}
	delete(pst.addErrorLogged, port)
}

// retryAppend reissues the iptables Append for a port whose previous
// tick succeeded at tracker.Add but failed at Append. Before retrying,
// re-probe the engine chain: if the engine chain has appeared since the
// failed Append, release ownership rather than installing a procnet
// PREROUTING DNAT that would shadow it.
func (pst *portStateTracker) retryAppend(port nat.Port, state portState) {
	managed, err := pst.anyEngineBinding(port, state.bindings)
	if err != nil {
		log.Debugf("/proc/net scanner engine-chain probe failed during append retry for %s; deferring: %s", port, err)
		return
	}
	if managed {
		// Delete procnet's committed rule before releasing the tracker
		// entry. The failed Append may have committed the rule (iptables
		// committed but returned non-zero); a leftover procnet rule
		// shadows the engine's chain. If the Delete fails, leave the
		// port appendFailed and keep the tracker entry so the next tick
		// retries -- releasing the proxy first would strand the port
		// with neither a working proxy nor a deleted rule. The retry
		// logs at Debug, matching the Append-retry path below.
		if err := pst.applyLoopbackRules(state.bindings, port, Delete); err != nil {
			log.Debugf("/proc/net scanner retry of iptables Delete for %s after engine takeover still failing: %s", port, err)
			return
		}
		if err := pst.tracker.Remove(syntheticIDFor(port)); err != nil {
			// APITracker.Remove clears portStorage via a leading defer,
			// so a next-tick retry would read an empty portMap, skip
			// the Unexpose loop, and return nil -- hiding the failure
			// rather than recovering. Accept the rare leak when
			// host-switch unexpose fails: a stranded gvisor proxy
			// under the synthetic ID blocks the engine's later Add
			// with "proxy already running" until RD restart, and on
			// the Local-collision configurations described in
			// exposeNew's engine-delegation comment, Windows-side
			// traffic for that host port drops until RD restart.
			if removeReportedProxyDestroyed(err) {
				log.Errorf("/proc/net scanner released ownership of %s after engine took over (wsl-proxy notification failed): %s", port, err)
			} else {
				log.Errorf("/proc/net scanner failed to release ownership of %s after engine took over; host-switch unexpose may have left the proxy bound until RD restart: %s", port, err)
			}
		}
		pst.added[port] = portState{bindings: state.bindings, delegated: true}
		log.Infof("/proc/net scanner released ownership of %s to engine-managed chain after append retry", port)
		return
	}
	if err := pst.applyLoopbackRules(state.bindings, port, Append); err != nil {
		log.Debugf("/proc/net scanner retry of iptables Append for %s still failing: %s", port, err)
		return
	}
	state.appendFailed = false
	pst.added[port] = state
	log.Infof("/proc/net scanner installed deferred iptables rule for port: %s -> %+v", port, state.bindings)
}

func (pst *portStateTracker) retireDisappeared(newPortMap nat.PortMap) {
	for port, state := range pst.added {
		if _, exists := newPortMap[port]; exists {
			continue
		}
		if state.delegated {
			// Engine owns the tracker entry and (if present) the
			// iptables rule. Drop the local marker without touching
			// either.
			log.Debugf("/proc/net scanner cleaning up delegated port: %s", port)
			delete(pst.added, port)
			continue
		}
		log.Infof("/proc/net scanner removed port: %s -> %+v", port, state.bindings)
		removeErr := pst.tracker.Remove(syntheticIDFor(port))
		// Drop the local marker unconditionally. APITracker.Remove
		// clears portStorage via a leading defer regardless of whether
		// the unexpose API or wsl-proxy.Send succeeded, so a retry on
		// the next tick is a silent no-op. Keeping the marker around
		// also deadlocks the Add path if the listener reappears (the
		// `alreadyAdded` fast path would short-circuit it).
		delete(pst.added, port)
		switch {
		case removeErr == nil:
			// Clean removal; fall through to delete the loopback rule.
		case removeReportedProxyDestroyed(removeErr):
			// Every host-switch Unexpose landed; only the wsl-proxy
			// notification failed, so the proxy is gone. Fall through
			// to delete the loopback rule -- a retained rule pointing
			// at a dead proxy would shadow a later bridge publish of
			// the same host port.
			log.Errorf("/proc/net scanner failed to remove port (wsl-proxy notification failed; loopback rule deleted): %s", removeErr)
		default:
			// The host-switch unexpose did not land, or the error is
			// unclassified, so the proxy may still be bound. Keep the
			// loopback rule so traffic still reaches the proxy; deleting
			// it would strand the port. A leaked rule self-cleans on RD
			// restart. Same trade-off as exposeNew's engine-delegation
			// path: a stranded gvisor proxy under the synthetic ID can
			// block a later same-host-port engine Add with "proxy
			// already running" on the Local-collision configurations
			// described in that comment.
			log.Errorf("/proc/net scanner failed to remove port (host-switch unexpose may have left proxy bound; loopback rule retained): %s", removeErr)
			continue
		}
		if err := pst.applyLoopbackRules(state.bindings, port, Delete); err != nil {
			log.Errorf("/proc/net scanner deleting loopback iptable rules for portbinding: %v failed: %s", state.bindings, err)
		}
	}
}

// cleanupErrorLogged drops the engine-probe and tracker.Add
// log-suppression markers for ports that disappeared without ever
// entering `added`. Their next sighting starts a fresh first-error cycle.
func (pst *portStateTracker) cleanupErrorLogged(newPortMap nat.PortMap) {
	for port := range pst.addErrorLogged {
		if _, exists := newPortMap[port]; !exists {
			delete(pst.addErrorLogged, port)
		}
	}
	for port := range pst.probeErrorLogged {
		if _, exists := newPortMap[port]; !exists {
			delete(pst.probeErrorLogged, port)
		}
	}
}

// anyEngineBinding reports whether any 127.0.0.1 binding of the port
// is already managed by a container-engine chain. Mirrors the existing
// per-binding semantics: short-circuits on the first match, defers on
// transient iptables error.
func (pst *portStateTracker) anyEngineBinding(port nat.Port, bindings []nat.PortBinding) (bool, error) {
	for _, binding := range bindings {
		if binding.HostIP != loopbackIP {
			continue
		}
		managed, err := pst.iptables.EngineManagesPort(port.Proto(), binding.HostPort)
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

// applyLoopbackRules dispatches an Append or Delete to the iptables
// runner for every 127.0.0.1 binding of the port. It processes all
// bindings even when one fails, joining the errors so the caller can
// defer to a later tick. A nat.Port carries at most one 127.0.0.1
// binding today; joining keeps the loop correct if that changes.
func (pst *portStateTracker) applyLoopbackRules(bindings []nat.PortBinding, port nat.Port, act action) error {
	var errs []error
	for _, binding := range bindings {
		if binding.HostIP != loopbackIP {
			continue
		}
		if err := pst.iptables.ApplyLoopbackRule(port.Proto(), binding.HostPort, act); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func syntheticIDFor(port nat.Port) string {
	return utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port()))
}

// removeReportedProxyDestroyed reports whether a non-nil tracker.Remove
// error indicates the host-switch proxy is gone (only the wsl-proxy
// notification failed). When true, callers may safely delete a procnet
// loopback rule or mark a port delegated; otherwise the
// gvisor-tap-vsock proxy may still be bound.
func removeReportedProxyDestroyed(err error) bool {
	return errors.Is(err, tracker.ErrWSLProxy) && !errors.Is(err, forwarder.ErrUnexposeAPI)
}
