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
	"crypto/md5"
	"fmt"
	"net"
	"sync"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/command"
)

const netsh = "netsh"

type portProxy struct {
	ports        nat.PortMap
	connectAddrs []types.ConnectAddrs
}

type proxy struct {
	portMappings map[string]portProxy
	mutex        sync.Mutex
}

func newProxy() *proxy {
	return &proxy{
		portMappings: make(map[string]portProxy),
	}
}

func (p *proxy) exec(portMapping types.PortMapping) error {
	portProxy := portProxy{
		ports:        portMapping.Ports,
		connectAddrs: portMapping.ConnectAddrs,
	}
	if portMapping.Remove {
		return p.delete(portProxy)
	}
	return p.add(portProxy)
}

func (p *proxy) removeAll() {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	for _, proxy := range p.portMappings {
		_ = p.delete(proxy)
	}
}

func (p *proxy) add(portProxy portProxy) error {
	for _, v := range portProxy.ports {
		for _, addr := range v {
			wslIP, err := getConnectAddr(addr.HostIP, portProxy.connectAddrs)
			if err != nil {
				return err
			}
			args, err := portProxyAddArgs(addr.HostPort, addr.HostIP, wslIP)
			if err != nil {
				return err
			}
			err = command.Exec(netsh, args)
			if err != nil {
				return err
			}
		}
	}
	p.mutex.Lock()
	p.portMappings[getHash(portProxy)] = portProxy
	p.mutex.Unlock()
	return nil
}

func (p *proxy) delete(portProxy portProxy) error {
	for _, v := range portProxy.ports {
		for _, addr := range v {
			args, err := portProxyDeleteArgs(addr.HostPort, addr.HostIP)
			if err != nil {
				return err
			}
			err = command.Exec(netsh, args)
			if err != nil {
				return err
			}
		}
	}
	delete(p.portMappings, getHash(portProxy))
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

func portProxyAddArgs(listenPort, listenAddr, connectAddr string) ([]string, error) {
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
		fmt.Sprintf("connectport=%s", listenPort),
		fmt.Sprintf("connectaddress=%s", connectAddr),
	}, nil
}

func getHash(portProxy portProxy) string {
	h := md5.New()
	s := fmt.Sprintf("%v", portProxy)
	return fmt.Sprintf("%x", h.Sum([]byte(s)))
}
