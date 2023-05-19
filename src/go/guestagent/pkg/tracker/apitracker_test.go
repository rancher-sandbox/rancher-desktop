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
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
	"github.com/stretchr/testify/assert"
)

const (
	hostSwitchIP = "192.168.127.2"
	containerID  = "containerID_1"
	containerID2 = "containerID_2"
	hostIP       = "127.0.0.1"
	hostIP2      = "127.0.0.2"
	hostIP3      = "127.0.0.3"
	hostPort     = "80"
	hostPort2    = "443"
)

func TestBasicAdd(t *testing.T) {
	t.Parallel()

	var expectedExposeReq *types.ExposeRequest

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		err := json.NewDecoder(r.Body).Decode(&expectedExposeReq)
		assert.NoError(t, err)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)
	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := apiTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	assert.Equal(t, expectedExposeReq.Local, ipPortBuilder(hostIP, hostPort))
	assert.Equal(t, expectedExposeReq.Remote, ipPortBuilder(hostSwitchIP, hostPort))

	actualPortMapping := apiTracker.Get(containerID)
	assert.Equal(t, portMapping, actualPortMapping)
}

func TestAddOverride(t *testing.T) {
	t.Parallel()

	var expectedExposeReq []*types.ExposeRequest

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.ExposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		assert.NoError(t, err)
		expectedExposeReq = append(expectedExposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)
	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err := apiTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:  ipPortBuilder(hostIP, hostPort),
				Remote: ipPortBuilder(hostSwitchIP, hostPort),
			},
			{
				Local:  ipPortBuilder(hostIP2, hostPort2),
				Remote: ipPortBuilder(hostSwitchIP, hostPort2),
			},
		})

	actualPortMapping := apiTracker.Get(containerID)
	assert.Equal(t, portMapping, actualPortMapping)

	// reset the exposeReq slice
	expectedExposeReq = nil

	portMapping2 := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
		"8080/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: "8080",
			},
		},
	}
	err = apiTracker.Add(containerID, portMapping2)
	assert.NoError(t, err)

	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:  ipPortBuilder(hostIP, hostPort),
				Remote: ipPortBuilder(hostSwitchIP, hostPort),
			},
			{
				Local:  ipPortBuilder(hostIP2, "8080"),
				Remote: ipPortBuilder(hostSwitchIP, "8080"),
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
		assert.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "Bad API error", http.StatusRequestTimeout)

			return
		}
		expectedExposeReq = append(expectedExposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)
	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
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
	err := apiTracker.Add(containerID, portMapping)
	assert.Error(t, err)

	errPortBinding := nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort,
	}
	nestedErr := fmt.Errorf("%w: Bad API error", tracker.ErrAPI)
	errs := []error{
		fmt.Errorf("exposing %+v failed: %w", errPortBinding, nestedErr),
	}
	expectedErr := fmt.Errorf("%w: %+v", tracker.ErrExposeAPI, errs)
	assert.EqualError(t, err, expectedErr.Error())

	assert.Len(t, expectedExposeReq, 2)
	assert.ElementsMatch(t, expectedExposeReq,
		[]*types.ExposeRequest{
			{
				Local:  ipPortBuilder(hostIP, hostPort),
				Remote: ipPortBuilder(hostSwitchIP, hostPort),
			},
			{
				Local:  ipPortBuilder(hostIP3, hostPort),
				Remote: ipPortBuilder(hostSwitchIP, hostPort),
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
	assert.Len(t, actualPortMapping["80/tcp"], 2)
	assert.NotContains(t, actualPortMapping["80/tcp"], nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort,
	})
	assert.Equal(t, actualPortMapping["80/tcp"],
		[]nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
			{
				HostIP:   hostIP3,
				HostPort: hostPort,
			},
		})
}

func TestGet(t *testing.T) {
	t.Parallel()

	portMapping := nat.PortMap{
		"443/tcp": []nat.PortBinding{
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

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)
	err := apiTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	actualPortMappings := apiTracker.Get(containerID)
	assert.Len(t, actualPortMappings, len(portMapping))
	assert.Equal(t, actualPortMappings["443/tcp"], portMapping["443/tcp"])
}

func TestRemove(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	var expectedUnexposeReq *types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		err := json.NewDecoder(r.Body).Decode(&expectedUnexposeReq)
		assert.NoError(t, err)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)
	portMapping1 := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
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
	err := apiTracker.Add(containerID, portMapping1)
	assert.NoError(t, err)
	err = apiTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	err = apiTracker.Remove(containerID)
	assert.NoError(t, err)

	assert.Equal(t, expectedUnexposeReq.Local, ipPortBuilder(hostIP, hostPort))

	expectedPortMapping1 := apiTracker.Get(containerID)
	assert.Nil(t, expectedPortMapping1)

	expectedPortMapping2 := apiTracker.Get(containerID2)
	assert.Equal(t, expectedPortMapping2, portMapping2)
}

func TestRemoveWithError(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	var expectedUnexposeReq []*types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.UnexposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		assert.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort) {
			http.Error(w, "Test API error", http.StatusRequestTimeout)

			return
		}
		expectedUnexposeReq = append(expectedUnexposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
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
	err := apiTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	err = apiTracker.Remove(containerID)
	assert.Error(t, err)

	errPortBinding := nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort,
	}
	nestedErr := fmt.Errorf("%w: Test API error", tracker.ErrAPI)
	errs := []error{
		fmt.Errorf("unexposing %+v failed: %w", errPortBinding, nestedErr),
	}
	expectedErr := fmt.Errorf("%w: %+v", tracker.ErrUnexposeAPI, errs)
	assert.EqualError(t, err, expectedErr.Error())

	assert.ElementsMatch(t, expectedUnexposeReq, []*types.UnexposeRequest{
		{Local: ipPortBuilder(hostIP, hostPort)},
		{Local: ipPortBuilder(hostIP3, hostPort)},
	})

	actualPortMapping := apiTracker.Get(containerID)
	assert.Nil(t, actualPortMapping)
}

func TestRemoveAll(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)

	portMapping1 := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
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
	err := apiTracker.Add(containerID, portMapping1)
	assert.NoError(t, err)

	err = apiTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	err = apiTracker.RemoveAll()
	assert.NoError(t, err)

	expectedPortMapping1 := apiTracker.Get(containerID)
	assert.Nil(t, expectedPortMapping1)

	expectedPortMapping2 := apiTracker.Get(containerID2)
	assert.Nil(t, expectedPortMapping2)
}

func TestRemoveAllWithError(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	var expectedUnexposeReq []*types.UnexposeRequest

	mux.HandleFunc("/services/forwarder/unexpose", func(w http.ResponseWriter, r *http.Request) {
		var tmpReq *types.UnexposeRequest
		err := json.NewDecoder(r.Body).Decode(&tmpReq)
		assert.NoError(t, err)
		if tmpReq.Local == ipPortBuilder(hostIP2, hostPort2) {
			http.Error(w, "RemoveAll API error", http.StatusRequestTimeout)

			return
		}
		expectedUnexposeReq = append(expectedUnexposeReq, tmpReq)
	})

	testSrv := httptest.NewServer(mux)
	defer testSrv.Close()

	apiTracker := tracker.NewAPITracker(testSrv.URL)

	portMapping1 := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
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
	err := apiTracker.Add(containerID, portMapping1)
	assert.NoError(t, err)

	err = apiTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	err = apiTracker.RemoveAll()
	assert.Error(t, err)

	errPortBinding := nat.PortBinding{
		HostIP:   hostIP2,
		HostPort: hostPort2,
	}
	nestedErr := fmt.Errorf("%w: RemoveAll API error", tracker.ErrAPI)
	errs := []error{
		fmt.Errorf("RemoveAll unexposing %+v failed: %w", errPortBinding, nestedErr),
	}
	expectedErr := fmt.Errorf("%w: %+v", tracker.ErrUnexposeAPI, errs)
	assert.EqualError(t, err, expectedErr.Error())

	assert.ElementsMatch(t, expectedUnexposeReq, []*types.UnexposeRequest{
		{Local: ipPortBuilder(hostIP, hostPort)},
		{Local: ipPortBuilder(hostIP3, hostPort2)},
	})

	expectedPortMapping1 := apiTracker.Get(containerID)
	assert.Nil(t, expectedPortMapping1)

	expectedPortMapping2 := apiTracker.Get(containerID2)
	assert.Nil(t, expectedPortMapping2)
}

func ipPortBuilder(ip, port string) string {
	return ip + ":" + port
}
