/*
Copyright © 2023 SUSE LLC
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

package tracker_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/docker/go-connections/nat"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	guestagentType "github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

const (
	hostSwitchIP   = "192.168.127.2"
	containerID    = "containerID_1"
	containerID2   = "containerID_2"
	hostIP         = "127.0.0.1"
	hostIP2        = "127.0.0.2"
	hostIP3        = "127.0.0.3"
	hostPort       = "80"
	hostPort2      = "443"
	additionalPort = "8080"
	protocolTCP    = "tcp"
	protocolUDP    = "udp"
)

func TestBasicAdd(t *testing.T) {
	t.Parallel()

	var expectedExposeReq *types.ExposeRequest

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(_ http.ResponseWriter, r *http.Request) {
		err := json.NewDecoder(r.Body).Decode(&expectedExposeReq)
		require.NoError(t, err)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	assert.Equal(t, expectedExposeReq.Local, ipPortBuilder(hostIP, hostPort))
	assert.Equal(t, expectedExposeReq.Remote, ipPortBuilder(hostSwitchIP, hostPort))

	actualPortMapping := apiTracker.Get(containerID)
	assert.Equal(t, portMapping, actualPortMapping)
}

func TestAddOverride(t *testing.T) {
	t.Parallel()

	var expectedExposeReq []*types.ExposeRequest

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(_ http.ResponseWriter, r *http.Request) {
		var tmpReq *types.ExposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		expectedExposeReq = append(expectedExposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	protoPort2, err := nat.NewPort(protocolTCP, hostPort2)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
		protoPort2: []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:    ipPortBuilder(hostIP, hostPort),
				Remote:   ipPortBuilder(hostSwitchIP, hostPort),
				Protocol: types.TransportProtocol(protocolTCP),
			},
			{
				Local:    ipPortBuilder(hostIP2, hostPort2),
				Remote:   ipPortBuilder(hostSwitchIP, hostPort2),
				Protocol: types.TransportProtocol(protocolTCP),
			},
		})

	actualPortMapping := apiTracker.Get(containerID)
	assert.Equal(t, portMapping, actualPortMapping)

	// reset the exposeReq slice
	expectedExposeReq = nil

	protoPort3, err := nat.NewPort(protocolUDP, additionalPort)
	require.NoError(t, err)

	portMapping2 := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
		protoPort3: []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: additionalPort,
			},
		},
	}
	err = apiTracker.Add(containerID, portMapping2)
	require.NoError(t, err)

	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:    ipPortBuilder(hostIP, hostPort),
				Remote:   ipPortBuilder(hostSwitchIP, hostPort),
				Protocol: types.TransportProtocol(protocolTCP),
			},
			{
				Local:    ipPortBuilder(hostIP2, additionalPort),
				Remote:   ipPortBuilder(hostSwitchIP, additionalPort),
				Protocol: types.TransportProtocol(protocolUDP),
			},
		})

	actualPortMapping = apiTracker.Get(containerID)
	assert.Equal(t, portMapping2, actualPortMapping)
}

func TestAddWithError(t *testing.T) {
	t.Parallel()

	var expectedExposeReq []*types.ExposeRequest

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.ExposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "Bad API error", http.StatusRequestTimeout)

			return
		}
		expectedExposeReq = append(expectedExposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
			{
				HostIP:   hostIP2,
				HostPort: hostPort,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.Error(t, err)

	errPortBinding := nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort,
	}
	nestedErr := fmt.Errorf("%w: Bad API error", tracker.ErrAPI)
	errs := []error{
		fmt.Errorf("exposing %+v failed: %w", errPortBinding, nestedErr),
	}
	expectedErr := fmt.Errorf("%w: %+v", forwarder.ErrExposeAPI, errs)
	require.EqualError(t, err, expectedErr.Error())

	assert.Len(t, expectedExposeReq, 2)
	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:    ipPortBuilder(hostIP, hostPort),
				Remote:   ipPortBuilder(hostSwitchIP, hostPort),
				Protocol: types.TransportProtocol(protocolTCP),
			},
			{
				Local:    ipPortBuilder(hostIP3, hostPort),
				Remote:   ipPortBuilder(hostSwitchIP, hostPort),
				Protocol: types.TransportProtocol(protocolTCP),
			},
		},
	)
	assert.NotContains(t, expectedExposeReq,
		&types.ExposeRequest{
			Local:  ipPortBuilder(hostIP2, hostPort),
			Remote: ipPortBuilder(hostSwitchIP, hostPort),
		},
	)

	actualPortMapping := apiTracker.Get(containerID)
	assert.Len(t, actualPortMapping[protoPort], 2)
	assert.NotContains(t, actualPortMapping[protoPort], nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort,
	})
	assert.Equal(t,
		[]nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort,
			},
		}, actualPortMapping[protoPort])
}

func TestGet(t *testing.T) {
	t.Parallel()

	protoPort, err := nat.NewPort(protocolTCP, hostPort2)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort2,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort2,
			},
		},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)
	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	actualPortMappings := apiTracker.Get(containerID)
	assert.Len(t, actualPortMappings, len(portMapping))
	assert.Equal(t, actualPortMappings["443/tcp"], portMapping["443/tcp"])
}

func TestRemove(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	var expectedUnexposeReq *types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(_ http.ResponseWriter, r *http.Request) {
		err := json.NewDecoder(r.Body).Decode(&expectedUnexposeReq)
		require.NoError(t, err)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	protoPort2, err := nat.NewPort(protocolTCP, hostPort2)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	portMapping2 := nat.PortMap{
		protoPort2: []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort2,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	err = apiTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	err = apiTracker.Remove(containerID)
	require.NoError(t, err)

	assert.Equal(t, expectedUnexposeReq.Local, ipPortBuilder(hostIP, hostPort))

	expectedPortMapping1 := apiTracker.Get(containerID)
	assert.Nil(t, expectedPortMapping1)

	expectedPortMapping2 := apiTracker.Get(containerID2)
	assert.Equal(t, expectedPortMapping2, portMapping2)
}

func TestRemoveWithError(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	var expectedUnexposeReq []*types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.UnexposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "Test API error", http.StatusRequestTimeout)

			return
		}
		expectedUnexposeReq = append(expectedUnexposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
			{
				HostIP:   hostIP2,
				HostPort: hostPort,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	err = apiTracker.Remove(containerID)
	require.Error(t, err)

	errPortBinding := nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort,
	}
	nestedErr := fmt.Errorf("%w: Test API error", tracker.ErrAPI)
	errs := []error{
		fmt.Errorf("unexposing %+v failed: %w", errPortBinding, nestedErr),
	}
	expectedErr := fmt.Errorf("%w: %+v", forwarder.ErrUnexposeAPI, errs)
	require.EqualError(t, err, expectedErr.Error())

	assert.ElementsMatch(t, expectedUnexposeReq, []*types.UnexposeRequest{
		{
			Local:    ipPortBuilder(hostIP, hostPort),
			Protocol: types.TransportProtocol(protocolTCP),
		},
		{
			Local:    ipPortBuilder(hostIP3, hostPort),
			Protocol: types.TransportProtocol(protocolTCP),
		},
	})

	actualPortMapping := apiTracker.Get(containerID)
	require.Len(t, actualPortMapping[protoPort], 1,
		"failing binding must remain in storage for retry")
	assert.Equal(t, hostIP2, actualPortMapping[protoPort][0].HostIP)
}

// TestRemoveRetainsFailedUnexposeInStorage pins the storage-retention
// path on partial Unexpose failure. Scenario: a containerID has three
// bindings; the Unexpose call for one binding fails. The entry for the
// failing binding must remain in portStorage so a later Remove can
// retry, the successfully-unexposed bindings must drop from storage,
// and wsl-proxy must be notified only of the successes.
func TestRemoveRetainsFailedUnexposeInStorage(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		var req *types.UnexposeRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		if req.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "Test API error", http.StatusRequestTimeout)
			return
		}
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	wslProxy := &testForwarder{}
	apiTracker := tracker.NewAPITracker(context.Background(), wslProxy, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{HostIP: hostIP, HostPort: hostPort},
			{HostIP: hostIP2, HostPort: hostPort},
			{HostIP: hostIP3, HostPort: hostPort},
		},
	}

	require.NoError(t, apiTracker.Add(containerID, portMapping))

	// Discard wsl-proxy mappings from Add; we only assert on what Remove sends.
	wslProxy.receivedPortMappings = nil

	err = apiTracker.Remove(containerID)
	require.Error(t, err, "Remove must surface the unexpose failure")
	require.ErrorIs(t, err, forwarder.ErrUnexposeAPI)

	remaining := apiTracker.Get(containerID)
	require.NotNil(t, remaining,
		"portStorage must retain the entry when any Unexpose fails")
	require.Len(t, remaining[protoPort], 1,
		"storage must contain the failing binding only")
	require.Equal(t, hostIP2, remaining[protoPort][0].HostIP,
		"the retained binding must be the one whose Unexpose failed")

	require.Len(t, wslProxy.receivedPortMappings, 1,
		"wsl-proxy must be notified once, for the successful unexposes")
	require.True(t, wslProxy.receivedPortMappings[0].Remove)
	var sentBindings []nat.PortBinding
	for _, bindings := range wslProxy.receivedPortMappings[0].Ports {
		sentBindings = append(sentBindings, bindings...)
	}
	sentIPs := make([]string, 0, len(sentBindings))
	for _, b := range sentBindings {
		sentIPs = append(sentIPs, b.HostIP)
	}
	assert.ElementsMatch(t, []string{hostIP, hostIP3}, sentIPs,
		"wsl-proxy must see only the successfully-unexposed bindings")
}

// TestRemoveWSLProxyFailureIsDistinguishable confirms that when every
// host-switch unexpose succeeds but the wsl-proxy notification fails,
// Remove reports the failure tagged ErrWSLProxy and NOT ErrUnexposeAPI.
// The /proc/net scanner's retireDisappeared relies on that distinction to
// tell that the host-switch proxy is gone and its loopback rule is now safe
// -- in fact necessary -- to delete.
func TestRemoveWSLProxyFailureIsDistinguishable(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	// Send fails only for the Remove notification, so Add still succeeds.
	wslProxy := &testForwarder{
		failCondition: func(pm guestagentType.PortMapping) error {
			if pm.Remove {
				return errors.New("simulated wsl proxy failure")
			}

			return nil
		},
	}
	apiTracker := tracker.NewAPITracker(context.Background(), wslProxy, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	err = apiTracker.Remove(containerID)
	require.Error(t, err)
	require.ErrorIs(t, err, tracker.ErrWSLProxy,
		"a wsl-proxy Send failure must be tagged ErrWSLProxy")
	require.NotErrorIs(t, err, forwarder.ErrUnexposeAPI,
		"a wsl-proxy-only failure must not be mistaken for an unexpose failure")
}

// TestAddBothFailuresAreDistinguishable confirms that when one Expose
// call fails (host-switch unreachable for that binding) AND the
// wsl-proxy notification also fails on the still-successful bindings,
// Add returns an error joined under both sentinels. Procnet decides
// recovery actions by classifying these sentinels independently, so a
// future refactor that early-returns after the Expose failure must not
// silently swallow the wsl-proxy failure.
func TestAddBothFailuresAreDistinguishable(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.ExposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "simulated host-switch error", http.StatusRequestTimeout)

			return
		}
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	// Send fails only for the Add notification, so successfullyForwarded
	// is non-empty (the hostIP and hostIP3 bindings succeeded) and the
	// wsl-proxy path runs and fails.
	wslProxy := &testForwarder{
		failCondition: func(pm guestagentType.PortMapping) error {
			if !pm.Remove {
				return errors.New("simulated wsl proxy failure")
			}

			return nil
		},
	}
	apiTracker := tracker.NewAPITracker(context.Background(), wslProxy, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{HostIP: hostIP, HostPort: hostPort},
			{HostIP: hostIP2, HostPort: hostPort},
			{HostIP: hostIP3, HostPort: hostPort},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.Error(t, err)
	require.ErrorIs(t, err, forwarder.ErrExposeAPI,
		"an Expose failure on one binding must be tagged ErrExposeAPI")
	require.ErrorIs(t, err, tracker.ErrWSLProxy,
		"a wsl-proxy Send failure on the successful bindings must be tagged ErrWSLProxy")
}

func TestRemoveAll(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	protoPort2, err := nat.NewPort(protocolTCP, hostPort2)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	portMapping2 := nat.PortMap{
		protoPort2: []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort2,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	err = apiTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	err = apiTracker.RemoveAll()
	require.NoError(t, err)

	expectedPortMapping1 := apiTracker.Get(containerID)
	assert.Nil(t, expectedPortMapping1)

	expectedPortMapping2 := apiTracker.Get(containerID2)
	assert.Nil(t, expectedPortMapping2)
}

func TestRemoveAllWithError(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	var expectedUnexposeReq []*types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.UnexposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort2) {
			http.Error(w, "RemoveAll API error", http.StatusRequestTimeout)

			return
		}
		expectedUnexposeReq = append(expectedUnexposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	protoPort2, err := nat.NewPort(protocolTCP, hostPort2)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	portMapping2 := nat.PortMap{
		protoPort2: []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort2,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	err = apiTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	err = apiTracker.RemoveAll()
	require.Error(t, err)

	errPortBinding := nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort2,
	}
	nestedErr := fmt.Errorf("%w: RemoveAll API error", tracker.ErrAPI)
	errs := []error{
		fmt.Errorf("RemoveAll unexposing %+v failed: %w", errPortBinding, nestedErr),
	}
	expectedErr := fmt.Errorf("%w: %+v", forwarder.ErrUnexposeAPI, errs)
	require.EqualError(t, err, expectedErr.Error())

	assert.ElementsMatch(t, expectedUnexposeReq, []*types.UnexposeRequest{
		{Local: ipPortBuilder(hostIP, hostPort)},
		{Local: ipPortBuilder(hostIP3, hostPort2)},
	})

	expectedPortMapping1 := apiTracker.Get(containerID)
	assert.Nil(t, expectedPortMapping1)

	expectedPortMapping2 := apiTracker.Get(containerID2)
	assert.Nil(t, expectedPortMapping2)
}

// TestRemoveAllBothFailuresAreDistinguishable confirms that when one
// Unexpose call fails AND the wsl-proxy notification fails on the
// surviving mappings, RemoveAll returns an error joined under both
// sentinels. Before APITracker switched to errors.Join, RemoveAll
// silently dropped the wsl-proxy failure once any Unexpose had
// errored; this test locks the new contract so a future refactor
// cannot regress to the early-return shape.
func TestRemoveAllBothFailuresAreDistinguishable(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.UnexposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort2) {
			http.Error(w, "simulated unexpose error", http.StatusRequestTimeout)

			return
		}
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	wslProxy := &testForwarder{
		failCondition: func(pm guestagentType.PortMapping) error {
			if pm.Remove {
				return errors.New("simulated wsl proxy failure")
			}

			return nil
		},
	}
	apiTracker := tracker.NewAPITracker(context.Background(), wslProxy, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	protoPort2, err := nat.NewPort(protocolTCP, hostPort2)
	require.NoError(t, err)

	err = apiTracker.Add(containerID, nat.PortMap{
		protoPort: []nat.PortBinding{{HostIP: hostIP, HostPort: hostPort}},
	})
	require.NoError(t, err)

	err = apiTracker.Add(containerID2, nat.PortMap{
		protoPort2: []nat.PortBinding{
			{HostIP: hostIP2, HostPort: hostPort2},
			{HostIP: hostIP3, HostPort: hostPort2},
		},
	})
	require.NoError(t, err)

	err = apiTracker.RemoveAll()
	require.Error(t, err)
	require.ErrorIs(t, err, forwarder.ErrUnexposeAPI,
		"an Unexpose failure must be tagged ErrUnexposeAPI")
	require.ErrorIs(t, err, tracker.ErrWSLProxy,
		"a concurrent wsl-proxy Send failure must be tagged ErrWSLProxy")
}

func TestNonAdminInstall(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	var expectedExposeReq []*types.ExposeRequest

	mux.HandleFunc("/services/forwarder/expose", func(_ http.ResponseWriter, r *http.Request) {
		var tmpReq *types.ExposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		expectedExposeReq = append(expectedExposeReq, tmpReq)
	})

	var expectedUnexposeReq []*types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(_ http.ResponseWriter, r *http.Request) {
		var tmpReq *types.UnexposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		require.NoError(t, err)
		expectedUnexposeReq = append(expectedUnexposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, false)

	publishedPort := "1025"
	protoPort, err := nat.NewPort(protocolTCP, publishedPort)
	require.NoError(t, err)

	portMapping := nat.PortMap{
		protoPort: []nat.PortBinding{
			{
				HostIP:   "192.168.0.124",
				HostPort: publishedPort,
			},
		},
	}

	err = apiTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:    ipPortBuilder("127.0.0.1", publishedPort),
				Remote:   ipPortBuilder(hostSwitchIP, publishedPort),
				Protocol: types.TransportProtocol(protocolTCP),
			},
		},
	)

	err = apiTracker.Remove(containerID)
	require.NoError(t, err)

	assert.ElementsMatch(t, expectedUnexposeReq,

		[]*types.UnexposeRequest{
			{
				Local:    ipPortBuilder("127.0.0.1", publishedPort),
				Protocol: types.TransportProtocol(protocolTCP),
			},
		})

	portMapping = apiTracker.Get(containerID)
	assert.Nil(t, portMapping)
}

// TestAddReturnsPortAlreadyExposedSentinel verifies that when host-switch
// rejects every Expose with the "proxy already running" body, Add returns
// the typed sentinel so callers can downgrade the result to a delegation
// no-op.
func TestAddReturnsPortAlreadyExposedSentinel(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "host port forwarding: cannot expose 127.0.0.1:80: proxy already running", http.StatusInternalServerError)
	})
	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	err = apiTracker.Add(containerID, nat.PortMap{
		protoPort: []nat.PortBinding{{HostIP: hostIP, HostPort: hostPort}},
	})
	require.ErrorIs(t, err, tracker.ErrPortAlreadyExposed)
	require.NotErrorIs(t, err, forwarder.ErrExposeAPI,
		"the sentinel must replace the generic ErrExposeAPI wrap, not be joined with it")

	// portStorage stays empty: no port was successfully forwarded.
	assert.Empty(t, apiTracker.Get(containerID))
}

// TestAddPartialAlreadyExposedReturnsNil verifies that when some ports
// succeed and others are already exposed elsewhere, Add returns nil --
// the call did real work and the sentinel only applies when nothing was
// forwarded.
func TestAddPartialAlreadyExposedReturnsNil(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		var req *types.ExposeRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		if req.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "proxy already running", http.StatusInternalServerError)
		}
	})
	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	err = apiTracker.Add(containerID, nat.PortMap{
		protoPort: []nat.PortBinding{
			{HostIP: hostIP, HostPort: hostPort},  // succeeds
			{HostIP: hostIP2, HostPort: hostPort}, // already exposed
		},
	})
	require.NoError(t, err)

	// Only the successful binding lands in storage.
	stored := apiTracker.Get(containerID)
	require.Len(t, stored[protoPort], 1)
	assert.Equal(t, hostIP, stored[protoPort][0].HostIP)
}

// TestAddAlreadyExposedPlusRealFailureReturnsRealFailure verifies that a
// real Expose failure beats the "already exposed" signal: callers must
// see the genuine ErrExposeAPI wrap so they retry, not the sentinel that
// would have them treat the call as delegation.
func TestAddAlreadyExposedPlusRealFailureReturnsRealFailure(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		var req *types.ExposeRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		switch req.Local {
		case ipPortBuilder(hostIP, hostPort):
			http.Error(w, "proxy already running", http.StatusInternalServerError)
		case ipPortBuilder(hostIP2, hostPort):
			http.Error(w, "transient backend error", http.StatusInternalServerError)
		}
	})
	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(context.Background(), &testForwarder{}, testSrv.URL, hostSwitchIP, true)

	protoPort, err := nat.NewPort(protocolTCP, hostPort)
	require.NoError(t, err)

	err = apiTracker.Add(containerID, nat.PortMap{
		protoPort: []nat.PortBinding{
			{HostIP: hostIP, HostPort: hostPort},  // already exposed
			{HostIP: hostIP2, HostPort: hostPort}, // real failure
		},
	})
	require.Error(t, err)
	require.ErrorIs(t, err, forwarder.ErrExposeAPI,
		"a real Expose failure must surface, not be masked by the sentinel")
	require.NotErrorIs(t, err, tracker.ErrPortAlreadyExposed,
		"the sentinel only applies when every port was already exposed")
}

func ipPortBuilder(ip, port string) string {
	return ip + ":" + port
}

type testForwarder struct {
	receivedPortMappings []guestagentType.PortMapping
	sendErr              error
	failCondition        func(guestagentType.PortMapping) error
}

func (v *testForwarder) Send(portMapping guestagentType.PortMapping) error {
	if v.failCondition != nil {
		if err := v.failCondition(portMapping); err != nil {
			return err
		}
	}

	v.receivedPortMappings = append(v.receivedPortMappings, portMapping)

	return v.sendErr
}
