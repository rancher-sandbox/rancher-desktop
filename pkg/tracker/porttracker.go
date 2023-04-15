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

// Package tracker implements a tracking mechanism to keep track
// of the ports during various container event types e.g start, stop
package tracker

import (
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
)

type Tracker interface {
	Get(containerID string) nat.PortMap
	Add(containerID string, portMapping nat.PortMap) error
	Remove(containerID string) error
	RemoveAll() error
	NetTracker
}

// PortTracker keeps track of port mappings and forwards
// them to the privileged service on the host over AF_VSOCK
// tunnel (vtunnel).
type PortTracker struct {
	portStorage      *portStorage
	vtunnelForwarder *forwarder.VtunnelForwarder
	wslAddrs         []types.ConnectAddrs
	*ListenerTracker
}

// NewPortTracker creates a new Port Tracker.
func NewPortTracker(forwarder *forwarder.VtunnelForwarder, wslAddrs []types.ConnectAddrs) *PortTracker {
	return &PortTracker{
		portStorage:      newPortStorage(),
		vtunnelForwarder: forwarder,
		wslAddrs:         wslAddrs,
		ListenerTracker:  NewListenerTracker(),
	}
}

// Add adds a container ID and port mapping to the tracker and calls the
// vtunnle forwarder to send the port mappings to privileged service.
func (p *PortTracker) Add(containerID string, portMap nat.PortMap) error {
	if len(portMap) == 0 {
		return nil
	}

	err := p.vtunnelForwarder.Send(types.PortMapping{
		Remove:       false,
		Ports:        portMap,
		ConnectAddrs: p.wslAddrs,
	})
	if err != nil {
		return err
	}

	p.portStorage.add(containerID, portMap)

	return nil
}

// Get gets a port mapping by container ID from the tracker.
func (p *PortTracker) Get(containerID string) nat.PortMap {
	return p.portStorage.get(containerID)
}

// Remove deletes a container ID and port mapping from the tracker and calls the
// vtunnle forwarder to send the port mappings to privileged service.
func (p *PortTracker) Remove(containerID string) error {
	portMap := p.portStorage.get(containerID)
	if len(portMap) != 0 {
		err := p.vtunnelForwarder.Send(types.PortMapping{
			Remove:       true,
			Ports:        portMap,
			ConnectAddrs: p.wslAddrs,
		})
		if err != nil {
			return err
		}

		p.portStorage.remove(containerID)
	}

	return nil
}

// RemoveAll removes all the port bindings from the tracker.
func (p *PortTracker) RemoveAll() error {
	p.portStorage.removeAll()

	return nil
}
