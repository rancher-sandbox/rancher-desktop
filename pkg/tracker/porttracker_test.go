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
	"errors"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"github.com/stretchr/testify/assert"
)

func TestPortTrackerAdd(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testVtunnelForwarder{}
	portTracker := tracker.NewPortTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := portTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = portTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 2)

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
}

func TestPortTrackerAddWithError(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testVtunnelForwarder{}
	forwarder.sendErr = errSend
	portTracker := tracker.NewPortTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := portTracker.Add(containerID, portMapping)
	assert.Error(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 1)

	assert.ElementsMatch(t, forwarder.receivedPortMappings,
		[]types.PortMapping{
			{
				Remove:       false,
				Ports:        portMapping,
				ConnectAddrs: wslConnectAddr,
			},
		})

	actualPortMapping := portTracker.Get(containerID)
	assert.Len(t, actualPortMapping, 0)
}

func TestPortTrackerRemove(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testVtunnelForwarder{}
	portTracker := tracker.NewPortTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := portTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = portTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 2)

	err = portTracker.Remove(containerID)
	assert.NoError(t, err)

	actualPortMapping1 := portTracker.Get(containerID)
	assert.Nil(t, actualPortMapping1)

	actualPortMapping2 := portTracker.Get(containerID2)
	assert.Equal(t, actualPortMapping2, nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	})

	assert.Equal(t, forwarder.receivedPortMappings[2],
		types.PortMapping{
			Remove:       true,
			Ports:        portMapping,
			ConnectAddrs: wslConnectAddr,
		})
}

func TestPortTrackerRemoveError(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testVtunnelForwarder{}
	portTracker := tracker.NewPortTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := portTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = portTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 2)

	forwarder.sendErr = errSend
	err = portTracker.Remove(containerID)
	assert.Error(t, err)

	actualPortMapping1 := portTracker.Get(containerID)
	assert.Equal(t, actualPortMapping1, nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	})

	actualPortMapping2 := portTracker.Get(containerID2)
	assert.Equal(t, actualPortMapping2, nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	})
}

func TestPortTrackerRemoveAll(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testVtunnelForwarder{}
	portTracker := tracker.NewPortTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := portTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	portMapping2 := nat.PortMap{
		"443/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP2,
				HostPort: hostPort2,
			},
		},
	}
	err = portTracker.Add(containerID2, portMapping2)
	assert.NoError(t, err)

	assert.Len(t, forwarder.receivedPortMappings, 2)

	err = portTracker.RemoveAll()
	assert.NoError(t, err)

	actualPortMapping1 := portTracker.Get(containerID)
	assert.Nil(t, actualPortMapping1)

	actualPortMapping2 := portTracker.Get(containerID2)
	assert.Nil(t, actualPortMapping2)
}

func TestPortTrackerGet(t *testing.T) {
	t.Parallel()

	wslConnectAddr := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	forwarder := testVtunnelForwarder{}
	portTracker := tracker.NewPortTracker(&forwarder, wslConnectAddr)

	portMapping := nat.PortMap{
		"80/tcp": []nat.PortBinding{
			{
				HostIP:   hostIP,
				HostPort: hostPort,
			},
		},
	}
	err := portTracker.Add(containerID, portMapping)
	assert.NoError(t, err)

	actualPortMap := portTracker.Get(containerID)
	assert.Equal(t, portMapping, actualPortMap)
}

var errSend = errors.New("error from Send")

type testVtunnelForwarder struct {
	receivedPortMappings []types.PortMapping
	sendErr              error
}

func (v *testVtunnelForwarder) Send(portMapping types.PortMapping) error {
	v.receivedPortMappings = append(v.receivedPortMappings, portMapping)

	return v.sendErr
}
