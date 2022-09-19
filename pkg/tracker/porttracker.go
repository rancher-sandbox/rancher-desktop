/*
Copyright © 2022 SUSE LLC
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
	"sync"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
)

// PortTracker mamanges published ports.
type PortTracker struct {
	// For docker the key is container ID
	portmap          map[string]nat.PortMap
	mutex            sync.Mutex
	vtunnelForwarder *forwarder.VtunnelForwarder
	wslAddrs         []types.ConnectAddrs
}

// NewPortTracker creates a new Port Tracker.
func NewPortTracker(forwarder *forwarder.VtunnelForwarder, wslAddrs []types.ConnectAddrs) *PortTracker {
	return &PortTracker{
		portmap:          make(map[string]nat.PortMap),
		vtunnelForwarder: forwarder,
		wslAddrs:         wslAddrs,
	}
}

// Add adds a container ID and port mapping to the tracker.
func (p *PortTracker) Add(containerID string, portMap nat.PortMap) error {
	p.mutex.Lock()
	p.portmap[containerID] = portMap
	log.Debugf("PortTracker Add status: %+v", p.portmap)
	p.mutex.Unlock()

	return p.vtunnelForwarder.Send(types.PortMapping{
		Remove:       false,
		Ports:        portMap,
		ConnectAddrs: p.wslAddrs,
	})
}

// Remove deletes a container ID and port mapping from the tracker.
func (p *PortTracker) Remove(containerID string) error {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	defer func() {
		delete(p.portmap, containerID)
		log.Debugf("PortTracker Remove status: %+v", p.portmap)
	}()

	err := p.vtunnelForwarder.Send(types.PortMapping{
		Remove:       true,
		Ports:        p.portmap[containerID],
		ConnectAddrs: p.wslAddrs,
	})
	if err != nil {
		return err
	}

	return nil
}

// Get gets a port mapping by container ID from the tracker.
func (p *PortTracker) Get(containerID string) nat.PortMap {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	log.Debugf("PortTracker Get status: %+v", p.portmap)
	portMap, ok := p.portmap[containerID]
	if ok {
		return portMap
	}

	return nil
}
