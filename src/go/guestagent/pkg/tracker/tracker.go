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
	"context"
	"net"

	"github.com/docker/go-connections/nat"
)

// NetTracker is the interface that wraps the methods
// that are used to manage Add/Remove tcp listeners.
type NetTracker interface {
	// AddListener creates a TCP listener for a given IP and Port
	// it returns an error if it fails.
	AddListener(ctx context.Context, ip net.IP, port int) error

	// RemoveListener removes a TCP listener for a given IP and Port
	// it returns an error if it fails.
	RemoveListener(ctx context.Context, ip net.IP, port int) error
}

// Tracker is the interface that includes all the functions that
// are used to keep track of the port mappings plus NetTracker methods
// that are used to keep track of the network listener creation and removal.
type Tracker interface {
	// Get returns a portMap using the containerID as a lookup Key.
	Get(containerID string) nat.PortMap

	// Add adds a portMap to the storage using the containerID as a Key
	// and returns an error if the it fails.
	Add(containerID string, portMapping nat.PortMap) error

	// Remove removes a portMap using the containerID as a key, if fails
	// it returns and error.
	Remove(containerID string) error

	// RemoveAll removes all the available portMappings in the storage,
	// if fails it reutrns an error.
	RemoveAll() error

	NetTracker
}
