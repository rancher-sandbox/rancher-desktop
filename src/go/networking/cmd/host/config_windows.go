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

package main

import (
	"net"

	"github.com/containers/gvisor-tap-vsock/pkg/types"

	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/config"
)

const (
	captureFile    = "capture.pcap"
	localHost      = "127.0.0.1"
	defaultMTU     = 1500
	gatewayMacAddr = "5a:94:ef:e4:0c:dd"
)

type arrayFlags []string

func (i *arrayFlags) String() string {
	return "Array Flags"
}

func (i *arrayFlags) Set(value string) error {
	*i = append(*i, value)
	return nil
}

func newConfig(subnet config.Subnet, staticPortForwarding map[string]string, debug bool) types.Configuration {
	c := types.Configuration{
		Debug:             debug,
		MTU:               defaultMTU,
		Subnet:            subnet.SubnetCIDR,
		GatewayIP:         subnet.GatewayIP,
		GatewayMacAddress: gatewayMacAddr,
		DHCPStaticLeases:  subnet.StaticDHCPLease,
		DNS: []types.Zone{
			{
				Name: "rancher-desktop.internal.",
				Records: []types.Record{
					{
						Name: "gateway",
						IP:   net.ParseIP(subnet.GatewayIP),
					},
					{
						Name: "host",
						IP:   net.ParseIP(subnet.StaticDNSHost),
					},
				},
			},
			{
				Name: "docker.internal.",
				Records: []types.Record{
					{
						Name: "gateway",
						IP:   net.ParseIP(subnet.GatewayIP),
					},
					{
						Name: "host",
						IP:   net.ParseIP(subnet.StaticDNSHost),
					},
				},
			},
		},
		DNSSearchDomains: config.SearchDomains(),
		Forwards:         staticPortForwarding,
		NAT: map[string]string{
			subnet.StaticDNSHost: localHost,
		},
		GatewayVirtualIPs: []string{subnet.StaticDNSHost},
	}
	if debug {
		c.CaptureFile = captureFile
	}
	return c
}
