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

package port

import (
	"fmt"
	"net"

	"k8s.io/kubernetes/pkg/util/netsh"
	"k8s.io/utils/exec"
)

func execProxy(portMapping PortMapping) error {
	if portMapping.Remove {
		return deleteProxy(portMapping)
	}
	return addProxy(portMapping)

}

func addProxy(portMapping PortMapping) error {
	for k, v := range portMapping.Ports {
		for _, addr := range v {
			wslIP, err := getConnectAddr(addr.HostIP, portMapping.ConnectAddrs)
			if err != nil {
				return err
			}
			args := portProxyAddArgs(addr.HostPort, addr.HostIP, k.Port(), wslIP)
			_, err = netsh.New(exec.New()).EnsurePortProxyRule(args)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func deleteProxy(portMapping PortMapping) error {
	for _, v := range portMapping.Ports {
		for _, addr := range v {
			args := portProxyDeleteArgs(addr.HostPort, addr.HostIP)
			_, err := netsh.New(exec.New()).EnsurePortProxyRule(args)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

// getConnectedAddr chooses an appropriate address IPv4 or IPv6
// based on a given host IP address
func getConnectAddr(listenIP string, connectAddrs []ConnectAddrs) (string, error) {
	for _, addr := range connectAddrs {
		wslIP, _, err := net.ParseCIDR(addr.Addr)
		if err != nil {
			return "", err
		}
		switch isIPv4(listenIP) {
		case true:
			if wslIP.To4() != nil {
				return wslIP.String(), nil
			}
		case false:
			if wslIP.To4() == nil {
				return wslIP.String(), nil
			}
		}
	}
	return "", fmt.Errorf("failed to find connect address: %v for listen IP: %s", connectAddrs, listenIP)
}

func isIPv4(addr string) bool {
	ip := net.ParseIP(addr)
	if ip.To4() != nil {
		return true
	}
	return false
}

func portProxyDeleteArgs(listenPort, listenAddr string) []string {
	var protoMapping string
	if isIPv4(listenAddr) {
		protoMapping = "v4tov4"
	} else {
		protoMapping = "v6tov6"
	}
	return []string{
		"interface",
		"portproxy",
		"delete",
		protoMapping,
		fmt.Sprintf("listenport=%s", listenPort),
		fmt.Sprintf("listenaddress=%s", listenAddr),
	}
}

func portProxyAddArgs(listenPort, listenAddr, connectPort, connectAddr string) []string {
	var protoMapping string
	if isIPv4(listenAddr) {
		protoMapping = "v4tov4"
	} else {
		protoMapping = "v6tov6"
	}
	return []string{
		"interface",
		"portproxy",
		"add",
		protoMapping,
		fmt.Sprintf("listenport=%s", listenPort),
		fmt.Sprintf("listenaddress=%s", listenAddr),
		fmt.Sprintf("connectport=%s", connectPort),
		fmt.Sprintf("connectaddress=%s", connectAddr),
	}
}
