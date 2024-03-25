/*
Copyright © 2024 SUSE LLC
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
package portproxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sync"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/utils"
	"github.com/sirupsen/logrus"
)

const bridgeIPAddr = "192.168.1.2"

type PortProxy struct {
	address  string
	listener net.Listener
	quit     chan struct{}
	// map of port number as a key to associated listener
	activeListeners map[int]net.Listener
	mutex           sync.Mutex
	wg              sync.WaitGroup
}

func NewPortProxy(address string) (*PortProxy, error) {
	socket, err := net.Listen("unix", address)

	portProxy := &PortProxy{
		address:         address,
		listener:        socket,
		quit:            make(chan struct{}),
		activeListeners: make(map[int]net.Listener),
	}
	return portProxy, err
}

func (p *PortProxy) Listen() error {
	logrus.Infof("Proxy server started listening on %s, forwarding to %s", p.address, bridgeIPAddr)
	for {
		conn, err := p.listener.Accept()
		if err != nil {
			select {
			case <-p.quit:
				return nil
			default:
				return fmt.Errorf("published port server connection accept error: %w", err)
			}
		} else {
			go p.handleEvent(conn)
		}
	}
}

func (p *PortProxy) handleEvent(conn net.Conn) {
	defer conn.Close()

	var pm types.PortMapping
	err := json.NewDecoder(conn).Decode(&pm)
	if err != nil {
		logrus.Errorf("port server decoding received payload error: %s", err)
		return
	}
	p.execListener(pm)
}

func (p *PortProxy) execListener(pm types.PortMapping) {
	for _, portBindings := range pm.Ports {
		for _, portBinding := range portBindings {
			logrus.Debugf("received the following port: [%s] from portMapping: %+v", portBinding.HostPort, pm)
			port, err := nat.ParsePort(portBinding.HostPort)
			if err != nil {
				logrus.Errorf("parsing port error: %s", err)
				continue
			}
			p.mutex.Lock()
			if pm.Remove {
				if listener, exist := p.activeListeners[port]; exist {
					if err := listener.Close(); err != nil {
						logrus.Errorf("error closing listener for port [%s]: %s", portBinding.HostPort, err)
					}
				}
				p.mutex.Unlock()
				continue
			}
			p.mutex.Unlock()
			addr := net.JoinHostPort("localhost", portBinding.HostPort)
			l, err := net.Listen("tcp", addr)
			if err != nil {
				logrus.Errorf("failed creating listener for published port [%s]: %s", portBinding.HostPort, err)
				continue
			}
			p.mutex.Lock()
			p.activeListeners[port] = l
			p.mutex.Unlock()
			go p.acceptTraffic(l, portBinding.HostPort)
		}
	}
}

func (p *PortProxy) acceptTraffic(listener net.Listener, port string) {
	forwardAddr := net.JoinHostPort(bridgeIPAddr, port)
	for {
		conn, err := listener.Accept()
		if err != nil {
			// Check if the error is due to listener being closed
			if errors.Is(err, net.ErrClosed) {
				break
			}
			logrus.Errorf("port proxy listener failed to accept: %s", err)
			continue
		}
		logrus.Debugf("port proxy accepted connection from %s", conn.RemoteAddr())
		p.wg.Add(1)

		go func(conn net.Conn) {
			defer p.wg.Done()
			defer conn.Close()
			utils.Pipe(conn, forwardAddr)
		}(conn)
	}
}

func (p *PortProxy) Wait() {
	p.wg.Wait()
}

func (p *PortProxy) Close() error {
	close(p.quit)
	return p.listener.Close()
}
