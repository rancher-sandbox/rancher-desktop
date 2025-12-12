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

// config contains all the configuration that is required by host switch.
package config

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
)

const (
	// Subnet range that is used by default if
	// one is not provided through the arguments.
	DefaultSubnet = "192.168.127.0/24"
	// Reserved Mac Address for the tap device eth0 that
	// is used by vm switch during the tap device
	// creation.
	TapDeviceMacAddr   = "5a:94:ef:e4:0c:ee"
	gatewayLastByte    = 1
	staticDHCPLastByte = 2
	staticHostLastByte = 254
)

// Subnet represents all the network properties
// that are required by the host switch process.
type Subnet struct {
	GatewayIP       string
	StaticDHCPLease map[string]string
	StaticDNSHost   string
	SubnetCIDR      string
}

// ValidateSubnet validates a given IP CIDR format and
// creates all the network addresses that are consumable
// by the host switch process.
func ValidateSubnet(subnet string) (*Subnet, error) {
	ip, _, err := net.ParseCIDR(subnet)
	if err != nil {
		return nil, fmt.Errorf("validating subnet: %w", err)
	}
	ipv4 := ip.To4()
	return &Subnet{
		GatewayIP: gatewayIP(ipv4),
		StaticDHCPLease: map[string]string{
			TapDeviceIP(ipv4): TapDeviceMacAddr,
		},
		StaticDNSHost: staticDNSHost(ipv4),
		SubnetCIDR:    subnet,
	}, nil
}

// SearchDomains reads the content of the /etc/resolv.conf when
// supported by the platform and returns an array of search domains.
func SearchDomains() []string {
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

// ParsePortForwarding converts the input format of HostIP:Port=GuestIP:Port
// into a map of {"HostIP:Port" : "GuestIP:Port"}
func ParsePortForwarding(ipPorts []string) (map[string]string, error) {
	portForwards := make(map[string]string)
	for _, v := range ipPorts {
		ipPort := strings.Split(v, "=")
		if len(ipPort) != 2 {
			return portForwards, fmt.Errorf("input %q not in expected format: HostIP:Port=GuestIP:Port", ipPort)
		}
		if err := validateIPPort(ipPort); err != nil {
			return portForwards, err
		}
		// "HostIP:Port" : "GuestIP:Port"
		portForwards[ipPort[0]] = ipPort[1]
	}
	return portForwards, nil
}

// TapDeviceIP returns the allocated IP address for
// the Tap Device.
func TapDeviceIP(ip net.IP) string {
	// Tap device IP is always x.x.x.2
	return net.IPv4(ip[0], ip[1], ip[2], staticDHCPLastByte).String()
}

func gatewayIP(ip net.IP) string {
	// Gateway is always x.x.x.1
	return net.IPv4(ip[0], ip[1], ip[2], gatewayLastByte).String()
}

func staticDNSHost(ip net.IP) string {
	// Static DNS Host is always x.x.x.254
	return net.IPv4(ip[0], ip[1], ip[2], staticHostLastByte).String()
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
