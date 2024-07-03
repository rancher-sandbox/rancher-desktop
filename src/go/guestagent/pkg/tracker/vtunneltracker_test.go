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
	"errors"
	"reflect"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVTunnelTrackerAdd(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = vtunnelTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	assert.ElementsMatch(t, forwarder.receivedPortMappings,
		[]types.PortMapping{
			{
				Remove:       false,
				Ports:        portMapping,
				ConnectAddrs: wslConnectAddr,
			}, {
				Remove:       false,
				Ports:        portMapping2,
				ConnectAddrs: wslConnectAddr,
			},
		})

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Equal(t, actualPortMapping, portMapping)

	actualPortMapping = vtunnelTracker.Get(containerID2)
	assert.Equal(t, actualPortMapping, portMapping2)
}

func TestVTunnelTrackerAddOverride(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

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
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	assert.ElementsMatch(t, forwarder.receivedPortMappings,
		[]types.PortMapping{
			{
				Remove:       false,
				Ports:        portMapping,
				ConnectAddrs: wslConnectAddr,
			},
		})

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Equal(t, actualPortMapping, portMapping)

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

	err = vtunnelTracker.Add(containerID, portMapping2)
	require.NoError(t, err)

	secondCallIndex := 1
	assert.Equal(t,
		types.PortMapping{
			Remove:       false,
			Ports:        portMapping2,
			ConnectAddrs: wslConnectAddr,
		},
		forwarder.receivedPortMappings[secondCallIndex])

	actualPortMapping = vtunnelTracker.Get(containerID)
	assert.Equal(t, actualPortMapping, portMapping2)
}

func TestVTunnelTrackerAddEmptyPortMap(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	forwarder.sendErr = errSend
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	assert.Empty(t, forwarder.receivedPortMappings, 0)

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Empty(t, actualPortMapping, 0)
}

func TestVTunnelTrackerAddWithError(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	forwarder.sendErr = errSend
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.ErrorIs(t, err, errSend)

	assert.ElementsMatch(t, forwarder.receivedPortMappings,
		[]types.PortMapping{
			{
				Remove:       false,
				Ports:        portMapping,
				ConnectAddrs: wslConnectAddr,
			},
		})

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Empty(t, actualPortMapping, 0)
}

func TestVTunnelTrackerRemove(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = vtunnelTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 2)

	err = vtunnelTracker.Remove(containerID)
	require.NoError(t, err)

	removeRequestIndex := 2
	assert.Equal(t,
		types.PortMapping{
			Remove:       true,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		}, forwarder.receivedPortMappings[removeRequestIndex])

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Nil(t, actualPortMapping)

	actualPortMapping = vtunnelTracker.Get(containerID2)
	assert.Equal(t, nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}, actualPortMapping)
}

func TestVTunnelTrackerRemoveZeroLengthPortMap(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	err = vtunnelTracker.Remove(containerID)
	require.NoError(t, err)
}

func TestVTunnelTrackerRemoveError(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = vtunnelTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 2)

	forwarder.sendErr = errSend
	err = vtunnelTracker.Remove(containerID)
	require.Error(t, err)

	removeRequestIndex := 2
	assert.Equal(t,
		types.PortMapping{
			Remove:       true,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		}, forwarder.receivedPortMappings[removeRequestIndex])

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Equal(t, nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}, actualPortMapping)

	actualPortMapping = vtunnelTracker.Get(containerID2)
	assert.Equal(t, nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}, actualPortMapping)
}

func TestVTunnelTrackerRemoveAll(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = vtunnelTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	err = vtunnelTracker.RemoveAll()
	require.NoError(t, err)

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Nil(t, actualPortMapping)

	actualPortMapping = vtunnelTracker.Get(containerID2)
	assert.Nil(t, actualPortMapping)

	assert.ElementsMatch(t, forwarder.receivedPortMappings, []types.PortMapping{
		{
			Remove:       false,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		},
		{
			Remove:       false,
			Ports:        portMapping2,
			ConnectAddrs: wslConnectAddr,
		},
		{
			Remove:       true,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		},
		{
			Remove:       true,
			Ports:        portMapping2,
			ConnectAddrs: wslConnectAddr,
		},
	})
}

func TestVTunnelTrackerRemoveAllError(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = vtunnelTracker.Add(containerID2, portMapping2)
	require.NoError(t, err)

	forwarder.failCondition = func(pm types.PortMapping) error {
		if _, ok := pm.Ports["443/tcp"]; ok {
			return &json.UnsupportedValueError{
				Value: reflect.Value{},
				Str:   "Not Supported!",
			}
		}

		return nil
	}
	err = vtunnelTracker.RemoveAll()
	require.ErrorIs(t, err, tracker.ErrRemoveAll)

	actualPortMapping := vtunnelTracker.Get(containerID)
	assert.Nil(t, actualPortMapping)

	actualPortMapping = vtunnelTracker.Get(containerID2)
	assert.Nil(t, actualPortMapping)

	assert.ElementsMatch(t, forwarder.receivedPortMappings, []types.PortMapping{
		{
			Remove:       false,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		},
		{
			Remove:       false,
			Ports:        portMapping2,
			ConnectAddrs: wslConnectAddr,
		},
		{
			Remove:       true,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		},
	})
}

func TestVTunnelTrackerGet(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testForwarder{}
	vtunnelTracker := tracker.NewVTunnelTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := vtunnelTracker.Add(containerID, portMapping)
	require.NoError(t, err)

	actualPortMap := vtunnelTracker.Get(containerID)
	assert.Equal(t, portMapping, actualPortMap)
}

var errSend = errors.New("error from Send")

type testForwarder struct {
	receivedPortMappings []types.PortMapping
	sendErr              error
	failCondition        func(types.PortMapping) error
}

func (v *testForwarder) Send(portMapping types.PortMapping) error {
	if v.failCondition != nil {
		if err := v.failCondition(portMapping); err != nil {
			return err
		}
	}

	v.receivedPortMappings = append(v.receivedPortMappings, portMapping)

	return v.sendErr
}
