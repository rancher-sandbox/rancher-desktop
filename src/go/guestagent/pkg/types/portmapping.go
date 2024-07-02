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

// Package types maintains common types that are used across
// different packages.
package types

import "github.com/docker/go-connections/nat"

// PortMapping is used to send Port/IP list over
// the Vtunnel to the RD Privileged Service.
type PortMapping struct {
	// Remove indicates whether to remove or add the entry
	Remove bool `json:"remove"`
	// Ports are the port mappings for both IPV4 and IPV6
	Ports nat.PortMap `json:"ports"`
	// ConnectAddrs are the backend addresses to connect to
	ConnectAddrs []ConnectAddrs `json:"connectAddrs"`
}

// ConnectAddrs represent the address for WSL interface
// inside the VM, this address is usually available on eth0.
type ConnectAddrs struct {
	// Network indicates the available networks for the address (for example, "tcp", "udp")
	Network string `json:"network"`
	// Address is either IPV4 or IPV6 (for example, "192.0.2.1:25", "[2001:db8::1]:80")
	Addr string `json:"addr"`
}
