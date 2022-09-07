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

	"github.com/docker/go-connections/nat"
)

// PortTracker mamanges published ports.
type PortTracker struct {
	// For docker the key is container ID
	portmap map[string]nat.PortMap
	mutex   sync.Mutex
}

// NewPortTracker creates a new Port Tracker.
func NewPortTracker() *PortTracker {
	return &PortTracker{
		portmap: make(map[string]nat.PortMap),
	}
}

// Add adds a container ID and port mapping to the tracker.
func (p *PortTracker) Add(containerID string, portMap nat.PortMap) {
	p.mutex.Lock()
	p.portmap[containerID] = portMap
	p.mutex.Unlock()
}

// Remove deletes a container ID and port mapping from the tracker.
func (p *PortTracker) Remove(containerID string) {
	p.mutex.Lock()
	delete(p.portmap, containerID)
	p.mutex.Unlock()
}
