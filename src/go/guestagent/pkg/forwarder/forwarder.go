/*
Copyright © 2024 SUSE LLC
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

// Package forwarder implements a forwarding mechanism to forward
// port mappings over the network.
package forwarder

import (
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

// Forwarder is the interface that wraps the Send method which
// to forward the port mappings.
type Forwarder interface {
	// Send sends the give port mappings to the Peer via
	// a tcp connection.
	Send(portMapping types.PortMapping) error
}
