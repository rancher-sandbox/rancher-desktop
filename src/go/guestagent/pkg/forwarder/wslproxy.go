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
// port mappings to Rancher Desktop WSL Proxy.
package forwarder

import (
	"encoding/json"
	"net"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

// WSLProxyForwarder forwards the PortMappings to Rancher Desktop WSLProxy process in
// the default namespace over the unix socket.
// For more information on Rancher Desktop WSL Proxy, refer to the source code at:
// https://github.com/rancher-sandbox/rancher-desktop-networking/blob/main/cmd/proxy/wsl_integration_linux.go
type WSLProxyForwarder struct {
	proxySocket string
}

func NewWSLProxyForwarder(proxySocket string) *WSLProxyForwarder {
	return &WSLProxyForwarder{
		proxySocket: proxySocket,
	}
}

// Send forwards the port mappings to WSL Proxy.
func (v *WSLProxyForwarder) Send(portMapping types.PortMapping) error {
	conn, err := net.Dial("unix", v.proxySocket)
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
