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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"

	gvisorTypes "github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/docker/go-connections/nat"
	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/utils"
)

type ProxyConfig struct {
	UpstreamAddress string
	UDPBufferSize   int
}

type PortProxy struct {
	ctx            context.Context
	config         *ProxyConfig
	listener       net.Listener
	quit           chan struct{}
	listenerConfig net.ListenConfig
	// map of TCP port number as a key to associated listener
	activeListeners map[int]net.Listener
	listenerMutex   sync.Mutex
	// map of UDP port number as a key to associated UDPConn
	activeUDPConns map[int]*net.UDPConn
	udpConnMutex   sync.Mutex
	wg             sync.WaitGroup
}

func NewPortProxy(ctx context.Context, listener net.Listener, cfg *ProxyConfig) *PortProxy {
	portProxy := &PortProxy{
		ctx:             ctx,
		config:          cfg,
		listener:        listener,
		quit:            make(chan struct{}),
		listenerConfig:  net.ListenConfig{},
		activeListeners: make(map[int]net.Listener),
		activeUDPConns:  make(map[int]*net.UDPConn),
	}
	return portProxy
}

func (p *PortProxy) Start() error {
	logrus.Infof("Proxy server started accepting on %s, forwarding to %s", p.listener.Addr(), p.config.UpstreamAddress)
	for {
		conn, err := p.listener.Accept()
		if err != nil {
			select {
			case <-p.quit:
				logrus.Debug("received a quit signal, exiting out of accept loop")
				return nil
			default:
				return fmt.Errorf("failed to accept connection: %w", err)
			}
		} else {
			go p.handleEvent(conn)
		}
	}
}

func (p *PortProxy) UDPPortMappings() map[int]*net.UDPConn {
	p.udpConnMutex.Lock()
	defer p.udpConnMutex.Unlock()
	return p.activeUDPConns
}

func (p *PortProxy) handleEvent(conn net.Conn) {
	defer conn.Close()

	var pm types.PortMapping
	if err := json.NewDecoder(conn).Decode(&pm); err != nil {
		logrus.Errorf("port server decoding received payload error: %s", err)
		return
	}
	p.exec(pm)
}

func (p *PortProxy) exec(pm types.PortMapping) {
	for portProto, portBindings := range pm.Ports {
		proto := strings.ToLower(portProto.Proto())
		logrus.Debugf("received the following port: [%s] and protocol: [%s] from portMapping: %+v", portProto.Port(), proto, pm)

		switch gvisorTypes.TransportProtocol(proto) {
		case gvisorTypes.TCP:
			p.handleTCP(portBindings, pm.Remove)
		case gvisorTypes.UDP:
			p.handleUDP(portBindings, pm.Remove)
		default:
			logrus.Warnf("unsupported protocol: [%s]", proto)
		}
	}
}

func (p *PortProxy) handleUDP(portBindings []nat.PortBinding, remove bool) {
	for _, portBinding := range portBindings {
		port, err := nat.ParsePort(portBinding.HostPort)
		if err != nil {
			logrus.Errorf("parsing port error: %s", err)
			continue
		}
		if remove {
			p.udpConnMutex.Lock()
			if udpConn, exist := p.activeUDPConns[port]; exist {
				if err := udpConn.Close(); err != nil {
					logrus.Errorf("error closing UDPConn for port [%s]: %s", portBinding.HostPort, err)
				}
			}
			delete(p.activeUDPConns, port)
			p.udpConnMutex.Unlock()
			logrus.Debugf("closing UDPConn for port: %d", port)
			continue
		}

		// the localAddress IP section can either be 0.0.0.0 or 127.0.0.1
		localAddress := net.JoinHostPort(portBinding.HostIP, portBinding.HostPort)
		sourceAddr, err := net.ResolveUDPAddr("udp", localAddress)
		if err != nil {
			logrus.Errorf("failed to resolve UDP source address [%s]: %s", sourceAddr, err)
			continue
		}

		c, err := net.ListenUDP("udp", sourceAddr)
		if err != nil {
			logrus.Errorf("failed creating listener for published port [%s]: %s", portBinding.HostPort, err)
			continue
		}

		forwardAddr := net.JoinHostPort(p.config.UpstreamAddress, portBinding.HostPort)
		targetAddr, err := net.ResolveUDPAddr("udp", forwardAddr)
		if err != nil {
			c.Close()
			logrus.Errorf("failed to resolve UDP target address [%s]: %s", targetAddr, err)
			continue
		}

		p.udpConnMutex.Lock()
		p.activeUDPConns[port] = c
		p.udpConnMutex.Unlock()
		logrus.Debugf("created UDPConn for: %v", sourceAddr)

		go p.acceptUDPConn(c, targetAddr)
	}
}

func (p *PortProxy) acceptUDPConn(sourceConn *net.UDPConn, targetAddr *net.UDPAddr) {
	targetConn, err := net.DialUDP("udp", nil, targetAddr)
	if err != nil {
		logrus.Errorf("failed to connect to target address: %s : %s", targetAddr, err)
		return
	}
	defer targetConn.Close()
	p.wg.Add(1)
	for {
		b := make([]byte, p.config.UDPBufferSize)
		n, addr, err := sourceConn.ReadFromUDP(b)
		if err != nil && n == 0 {
			logrus.Errorf("error reading UDP packet from source: %s : %s", addr, err)
			if errors.Is(err, net.ErrClosed) {
				p.wg.Done()
				break
			}
			continue
		}
		logrus.Debugf("received %d data from %s", n, addr)

		n, err = targetConn.Write(b[:n])
		if err != nil {
			logrus.Errorf("error forwarding UDP packet to target: %s : %s", targetAddr, err)
			if errors.Is(err, net.ErrClosed) {
				p.wg.Done()
				break
			}
			continue
		}
		logrus.Debugf("sent %d data to %s", n, targetAddr)
	}
}

func (p *PortProxy) handleTCP(portBindings []nat.PortBinding, remove bool) {
	for _, portBinding := range portBindings {
		port, err := nat.ParsePort(portBinding.HostPort)
		if err != nil {
			logrus.Errorf("parsing port error: %s", err)
			continue
		}
		if remove {
			p.listenerMutex.Lock()
			if listener, exist := p.activeListeners[port]; exist {
				logrus.Debugf("closing listener for port: %d", port)
				if err := listener.Close(); err != nil {
					logrus.Errorf("error closing listener for port [%s]: %s", portBinding.HostPort, err)
				}
			}
			delete(p.activeListeners, port)
			p.listenerMutex.Unlock()
			continue
		}
		addr := net.JoinHostPort(portBinding.HostIP, portBinding.HostPort)
		l, err := p.listenerConfig.Listen(p.ctx, "tcp", addr)
		if err != nil {
			logrus.Errorf("failed creating listener for published port [%s]: %s", portBinding.HostPort, err)
			continue
		}
		p.listenerMutex.Lock()
		p.activeListeners[port] = l
		p.listenerMutex.Unlock()
		logrus.Debugf("created listener for: %s", addr)
		go p.acceptTraffic(l, portBinding.HostPort)
	}
}

func (p *PortProxy) acceptTraffic(listener net.Listener, port string) {
	forwardAddr := net.JoinHostPort(p.config.UpstreamAddress, port)
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
		logrus.Debugf("port proxy accepted TCP connection from %s", conn.RemoteAddr())
		p.wg.Add(1)

		go func(conn net.Conn) {
			defer p.wg.Done()
			defer conn.Close()
			utils.Pipe(p.ctx, conn, forwardAddr)
		}(conn)
	}
}

func (p *PortProxy) Close() error {
	// Close all the active listeners
	p.cleanupListeners()

	// Close all active UDP connections
	p.cleanupUDPConns()

	// Close the listener first to prevent new connections.
	err := p.listener.Close()
	if err != nil {
		return err
	}

	// Signal the quit channel to stop accepting new connections.
	close(p.quit)

	// Wait for all pending connections to finish.
	p.wg.Wait()

	return nil
}

func (p *PortProxy) cleanupListeners() {
	p.listenerMutex.Lock()
	defer p.listenerMutex.Unlock()
	for _, l := range p.activeListeners {
		_ = l.Close()
	}
}

func (p *PortProxy) cleanupUDPConns() {
	p.udpConnMutex.Lock()
	defer p.udpConnMutex.Unlock()
	for _, c := range p.activeUDPConns {
		_ = c.Close()
	}
}
