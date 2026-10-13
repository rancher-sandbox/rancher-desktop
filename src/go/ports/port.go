// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package ports

import (
	"fmt"
	"strconv"
	"strings"
)

// Port is a port number and protocol, such as "80/tcp".
type Port string

// PortBinding is a host IP address and port bound to a Port.
type PortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

// PortMap holds the host bindings of each Port.
type PortMap map[Port][]PortBinding

// NewPort returns the Port for a protocol and a port number.
func NewPort(proto, port string) (Port, error) {
	number, err := parsePortNumber(port)
	if err != nil {
		return "", err
	}
	return Port(fmt.Sprintf("%d/%s", number, proto)), nil
}

// Proto returns the protocol of p, or "tcp" when p has none.
func (p Port) Proto() string {
	_, proto, _ := strings.Cut(string(p), "/")
	if proto == "" {
		return "tcp"
	}
	return proto
}

// Port returns the port number of p.
func (p Port) Port() string {
	port, _, _ := strings.Cut(string(p), "/")
	return port
}

// ParsePort parses a port number from 0 to 65535, and returns 0 for an
// empty string.
func ParsePort(rawPort string) (int, error) {
	if rawPort == "" {
		return 0, nil
	}
	return parsePortNumber(rawPort)
}

func parsePortNumber(rawPort string) (int, error) {
	port, err := strconv.Atoi(rawPort)
	if err != nil || port < 0 || port > 65535 {
		return 0, fmt.Errorf("invalid port %q: want a number from 0 to 65535", rawPort)
	}
	return port, nil
}
