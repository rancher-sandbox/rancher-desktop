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

	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"k8s.io/kubernetes/pkg/util/netsh"
	"k8s.io/utils/exec"
)

type portProxy struct {
	netsh.Interface
}

func newPortProxy() *portProxy {
	return &portProxy{
		netsh.New(exec.New()),
	}
}

func (p *portProxy) execProxy(portMapping types.PortMapping) error {
	if portMapping.Remove {
		return p.deleteProxy(portMapping)
	}
	return p.addProxy(portMapping)

}

func (p *portProxy) addProxy(portMapping types.PortMapping) error {
	for k, v := range portMapping.Ports {
		for _, addr := range v {
			wslIP, err := getConnectAddr(addr.HostIP, portMapping.ConnectAddrs)
			if err != nil {
				return err
			}
			args, err := portProxyAddArgs(addr.HostPort, addr.HostIP, k.Port(), wslIP)
			if err != nil {
				return err
			}
			_, err = p.EnsurePortProxyRule(args)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (p *portProxy) deleteProxy(portMapping types.PortMapping) error {
	for _, v := range portMapping.Ports {
		for _, addr := range v {
			args, err := portProxyDeleteArgs(addr.HostPort, addr.HostIP)
			if err != nil {
				return err
			}
			err = p.DeletePortProxyRule(args)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

// getConnectedAddr selects an IP address from connectAddrs that is the same
// type (IPv4 or IPv6) as listenIP.
func getConnectAddr(listenIP string, connectAddrs []types.ConnectAddrs) (string, error) {
	isIPv4, err := isIPv4(listenIP)
	if err != nil {
		return "", err
	}
	for _, addr := range connectAddrs {
		wslIP, _, err := net.ParseCIDR(addr.Addr)
		if err != nil {
			return "", err
		}
		switch isIPv4 {
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

func isIPv4(addr string) (bool, error) {
	ip := net.ParseIP(addr)
	if ip == nil {
		return false, fmt.Errorf("invalid IP address: %s", addr)
	}
	if ip.To4() != nil {
		return true, nil
	}
	return false, nil
}

func portProxyDeleteArgs(listenPort, listenAddr string) ([]string, error) {
	var protoMapping string
	isIPv4, err := isIPv4(listenAddr)
	if err != nil {
		return nil, err
	}
	if isIPv4 {
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
	}, nil
}

func portProxyAddArgs(listenPort, listenAddr, connectPort, connectAddr string) ([]string, error) {
	var protoMapping string
	isIPv4, err := isIPv4(listenAddr)
	if err != nil {
		return nil, err
	}
	if isIPv4 {
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
	}, nil
}
