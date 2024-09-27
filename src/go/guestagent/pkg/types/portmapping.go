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

// PortMapping represents the mapping of ports and addresses to be communicated
// over the network. It includes a flag (remove) on whether to add or remove port mappings
// and specifies the backend addresses to connect to.
type PortMapping struct {
	// Remove indicates whether the port mappings should be removed (true) or added (false)
	Remove bool `json:"remove"`
	// Ports contains the port mappings for both IPv4 and IPv6 addresses.  The host address
	// listed refers to the machine running the VM, i.e. the Windows machine.
	Ports nat.PortMap `json:"ports"`
	// ConnectAddrs lists the backend addresses for connections; the addresses are recorded
	// in terms of the network namespace the container engine is running in (i.e. the
	// "Rancher Desktop" network namespace).
	ConnectAddrs []ConnectAddrs `json:"connectAddrs"`
}

// ConnectAddrs defines a network address used for the WSL interface inside
// the VM. Typically, this address is found on the eth0 interface.
type ConnectAddrs struct {
	// Network specifies the protocol or network type for the address (e.g., "tcp", "udp")
	Network string `json:"network"`
	// Addr is the network address, which can be either IPv4 or IPv6 (e.g., "192.0.2.1:25", "[2001:db8::1]:80")
	Addr string `json:"addr"`
}
