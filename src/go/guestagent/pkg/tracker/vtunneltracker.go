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
	"errors"
	"fmt"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

var ErrRemoveAll = errors.New("failed to remove all portMappings")

// VTunnelTracker keeps track of port mappings and forwards
// them to the privileged service on the host over AF_VSOCK
// tunnel (vtunnel).
type VTunnelTracker struct {
	portStorage      *portStorage
	vtunnelForwarder forwarder.Forwarder
	wslAddrs         []types.ConnectAddrs
	*ListenerTracker
}

// NewVTunnelTracker creates a new Port Tracker.
func NewVTunnelTracker(vtunnelForwarder forwarder.Forwarder, wslAddrs []types.ConnectAddrs) *VTunnelTracker {
	return &VTunnelTracker{
		portStorage:      newPortStorage(),
		vtunnelForwarder: vtunnelForwarder,
		wslAddrs:         wslAddrs,
		ListenerTracker:  NewListenerTracker(),
	}
}

// Add a container ID and port mapping to the tracker and calls the
// vtunnel forwarder to send the port mappings to privileged service.
func (p *VTunnelTracker) Add(containerID string, portMap nat.PortMap) error {
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
func (p *VTunnelTracker) Get(containerID string) nat.PortMap {
	return p.portStorage.get(containerID)
}

// Remove deletes a container ID and port mapping from the tracker and calls the
// vtunnel forwarder to send the port mappings to privileged service.
func (p *VTunnelTracker) Remove(containerID string) error {
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
func (p *VTunnelTracker) RemoveAll() error {
	defer p.portStorage.removeAll()

	allPortMappings := p.portStorage.getAll()

	var errs []error

	for _, portMap := range allPortMappings {
		err := p.vtunnelForwarder.Send(types.PortMapping{
			Remove:       true,
			Ports:        portMap,
			ConnectAddrs: p.wslAddrs,
		})
		if err != nil {
			errs = append(errs, err)
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrRemoveAll, errs)
	}

	return nil
}
