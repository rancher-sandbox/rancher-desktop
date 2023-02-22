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
	"bufio"
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/sirupsen/logrus"
)

const (
	captureFile        = "capture.pcap"
	localHost          = "127.0.0.1"
	tapDeviceMacAddr   = "5a:94:ef:e4:0c:ee"
	gatewayMacAddr     = "5a:94:ef:e4:0c:dd"
	defaultSubnet      = "192.168.127.0/24"
	defaultMTU         = 1500
	gatewayLastByte    = 1
	staticDHCPLastByte = 2
	staticHostLastByte = 254
)

type arrayFlags []string

func (i *arrayFlags) String() string {
	return "Array Flags"
}

func (i *arrayFlags) Set(value string) error {
	*i = append(*i, value)
	return nil
}

type subnet struct {
	IP              string
	GatewayIP       string
	StaticDHCPLease map[string]string
	StaticDNSHost   string
	SubnetCIDR      string
}

func validateSubnet(s string) (*subnet, error) {
	ip, _, err := net.ParseCIDR(s)
	if err != nil {
		return nil, fmt.Errorf("validating subnet: %w", err)
	}
	ipv4 := ip.To4()
	return &subnet{
		IP:              ip.String(),
		GatewayIP:       gatewayIP(ipv4),
		StaticDHCPLease: staticDHCP(ipv4),
		StaticDNSHost:   staticDNSHost(ipv4),
		SubnetCIDR:      s,
	}, nil
}

func gatewayIP(ip net.IP) string {
	// Gateway is always x.x.x.1
	return net.IPv4(ip[0], ip[1], ip[2], gatewayLastByte).String()
}

func staticDHCP(ip net.IP) map[string]string {
	// Static DHCP Lease is always x.x.x.2
	tapDevIP := net.IPv4(ip[0], ip[1], ip[2], staticDHCPLastByte).String()
	return map[string]string{
		tapDevIP: tapDeviceMacAddr,
	}
}

func staticDNSHost(ip net.IP) string {
	// Static DNS Host is always x.x.x.254
	return net.IPv4(ip[0], ip[1], ip[2], staticHostLastByte).String()
}

// parsePortForwarding converts the input format of HostIP:Port=GuestIP:Port
// into a map of {"HostIP:Port" : "GuestIP:Port"}
func parsePortForwarding(ipPorts []string) (map[string]string, error) {
	portForwardings := make(map[string]string)
	for _, v := range ipPorts {
		ipPort := strings.Split(v, "=")
		if len(ipPort) != 2 {
			return portForwardings, fmt.Errorf("input %q not in expected format: HostIP:Port=GuestIP:Port", ipPort)
		}
		if err := validateIPPort(ipPort); err != nil {
			return portForwardings, err
		}
		// "HostIP:Port" : "GuestIP:Port"
		portForwardings[ipPort[0]] = ipPort[1]
	}
	return portForwardings, nil
}

func validateIPPort(ipPorts []string) error {
	for _, ipPort := range ipPorts {
		ip, port, err := net.SplitHostPort(ipPort)
		if err != nil {
			return err
		}
		intPort, err := strconv.Atoi(port)
		if err != nil {
			return err
		}
		if intPort <= 0 || intPort > 65535 {
			return fmt.Errorf("invalid port number provided: %d", intPort)
		}
		if net.ParseIP(ip) == nil {
			return fmt.Errorf("invalid IP address provided: %s", ip)
		}
	}
	return nil
}

func searchDomains() []string {
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		f, err := os.Open("/etc/resolv.conf")
		if err != nil {
			logrus.Errorf("open file error: %v", err)
			return nil
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		searchPrefix := "search "
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), searchPrefix) {
				searchDomains := strings.Split(strings.TrimPrefix(sc.Text(), searchPrefix), " ")
				logrus.Debugf("Using search domains: %v", searchDomains)
				return searchDomains
			}
		}
		if err := sc.Err(); err != nil {
			logrus.Errorf("scan file error: %v", err)
			return nil
		}
	}
	return nil
}

func newConfig(subnet subnet, staticPortForwarding map[string]string, debug bool) types.Configuration {
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
		DNSSearchDomains: searchDomains(),
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
