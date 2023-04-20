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

// Package forwarder implements a forwarding mechanism to forward
// port mappings over Vtunnel.
package forwarder

import (
	"encoding/json"
	"net"

	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
)

type Forwarder interface {
	Send(portMapping types.PortMapping) error
}

// VtunnelForwarder forwards the PortMappings to Vtunnel Peer process.
type VtunnelForwarder struct {
	peerAddr string
}

func NewVtunnelForwarder(peerAddr string) *VtunnelForwarder {
	return &VtunnelForwarder{
		peerAddr: peerAddr,
	}
}

// Send forwards the port mappings to Vtunnel Peer.
func (v *VtunnelForwarder) Send(portMapping types.PortMapping) error {
	conn, err := net.Dial("tcp", v.peerAddr)
	if err != nil {
		return err
	}
	defer conn.Close()

	err = json.NewEncoder(conn).Encode(portMapping)
	if err != nil {
		return err
	}

	return nil
}
