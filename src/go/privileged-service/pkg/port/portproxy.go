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

package port

import (
	"crypto/md5"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sort"
	"sync"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/command"
)

const netsh = "netsh"

var ErrPortProxy = errors.New("error from PortProxy")

type portProxy struct {
	PortMap      nat.PortMap
	ConnectAddrs []types.ConnectAddrs
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
	port := portProxy{
		PortMap:      portMapping.Ports,
		ConnectAddrs: portMapping.ConnectAddrs,
	}
	if portMapping.Remove {
		return p.delete(port)
	}
	return p.add(port)
}

func (p *proxy) add(port portProxy) error {
	for _, v := range port.PortMap {
		for _, addr := range v {
			wslIP, err := getConnectAddr(addr.HostIP, port.ConnectAddrs)
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
	hash, err := getHash(port)
	if err != nil {
		return err
	}
	// Ideally we would want to have the mutex lock around the entire add
	// function to create an atomic operation for adding netsh and adding
	// the portMappings cache. However, we don't want the netsh operation
	// to be impacted by the lock contention and it is acceptable for cache
	// to fall out of sync with netsh since the cost is cheap. When the cache
	// attempts to remove an entry that does not exist or double remove an entry
	// we would ignore the error and move on.
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.portMappings[hash] = port
	return nil
}

func (p *proxy) delete(port portProxy) error {
	if err := execNetshDelete(port); err != nil {
		return err
	}

	hash, err := getHash(port)
	if err != nil {
		return err
	}
	// Ideally we would want to have the mutex lock around the entire delete
	// function to create an atomic operation for deleting netsh and removing
	// the portMappings cache. However, we don't want the netsh operation
	// to be impacted by the lock contention and it is acceptable for cache
	// to fall out of sync with netsh since the cost is cheap. When the cache
	// attempts to remove an entry that does not exist or double remove an entry
	// we would ignore the error and move on.
	p.mutex.Lock()
	defer p.mutex.Unlock()
	delete(p.portMappings, hash)
	return nil
}

func (p *proxy) removeAll() error {
	errs := make([]error, 0)
	p.mutex.Lock()
	defer p.mutex.Unlock()
	for _, proxy := range p.portMappings {
		if err := execNetshDelete(proxy); err != nil {
			errs = append(errs, fmt.Errorf("deleting portproxy: %+v faile: %w", proxy, err))
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return fmt.Errorf("%w: %+v", ErrPortProxy, errs)
}

func execNetshDelete(port portProxy) error {
	for _, v := range port.PortMap {
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

func getHash(ports portProxy) (string, error) {
	sort.Slice(ports.ConnectAddrs, func(i, j int) bool {
		return ports.ConnectAddrs[i].Addr < ports.ConnectAddrs[j].Addr
	})
	for _, portBinding := range ports.PortMap {
		sort.Slice(portBinding, func(i, j int) bool {
			return portBinding[i].HostIP < portBinding[j].HostIP
		})
	}
	b, err := json.Marshal(ports)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", md5.Sum(b)), nil
}
