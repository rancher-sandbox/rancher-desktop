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

// Package tracker implements a tracking mechanism to keep track
// of the ports during various container event types e.g start, stop
package tracker

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"syscall"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"golang.org/x/sys/unix"
)

type Tracker interface {
	Get(containerID string) nat.PortMap
	Add(containerID string, portMapping nat.PortMap) error
	Remove(containerID string) error
	RemoveAll()
	AddListener(ctx context.Context, ip net.IP, port int) error
	RemoveListener(ctx context.Context, ip net.IP, port int) error
}

// PortTracker keeps track of port mappings and forwards
// them to the privileged service on the host over AF_VSOCK
// tunnel (vtunnel).
type PortTracker struct {
	portStorage      *portStorage
	vtunnelForwarder *forwarder.VtunnelForwarder
	wslAddrs         []types.ConnectAddrs
	// outstanding listeners; the key is generated via ipPortToAddr.
	listeners map[string]net.Listener
	mutex     sync.Mutex
}

// NewPortTracker creates a new Port Tracker.
func NewPortTracker(forwarder *forwarder.VtunnelForwarder, wslAddrs []types.ConnectAddrs) *PortTracker {
	return &PortTracker{
		portStorage:      newPortStorage(),
		vtunnelForwarder: forwarder,
		wslAddrs:         wslAddrs,
		listeners:        make(map[string]net.Listener),
	}
}

// Add adds a container ID and port mapping to the tracker.
func (p *PortTracker) Add(containerID string, portMap nat.PortMap) error {
	if len(portMap) == 0 {
		return nil
	}

	err := p.vtunnelForwarder.Send(types.PortMapping{
		Remove:       false,
		Ports:        portMap,
		ConnectAddrs: p.wslAddrs,
	})
	if err != nil {
		return err
	}

	p.portStorage.add(containerID, portMap)

	return nil
}

// Get gets a port mapping by container ID from the tracker.
func (p *PortTracker) Get(containerID string) nat.PortMap {
	return p.portStorage.get(containerID)
}

// Remove deletes a container ID and port mapping from the tracker.
func (p *PortTracker) Remove(containerID string) error {
	portMap := p.portStorage.get(containerID)
	if len(portMap) != 0 {
		err := p.vtunnelForwarder.Send(types.PortMapping{
			Remove:       true,
			Ports:        portMap,
			ConnectAddrs: p.wslAddrs,
		})
		if err != nil {
			return err
		}

		p.portStorage.remove(containerID)
	}

	return nil
}

// RemoveAll removes all the port bindings from the tracker.
func (p *PortTracker) RemoveAll() {
	p.portStorage.removeAll()
}

// AddListener adds an IP / port combination into the listener tracker.
// If this combination is already being tracked, this is a no-op.
func (p *PortTracker) AddListener(ctx context.Context, ip net.IP, port int) error {
	addr := ipPortToAddr(ip, port)

	listener, err := listen(ctx, addr)
	if err != nil {
		return err
	}

	p.mutex.Lock()
	p.listeners[addr] = listener
	p.mutex.Unlock()

	return nil
}

// RemoveListener removes an IP / port combination from the listener tracker.  If this
// combination was not being tracked, this is a no-op.
func (p *PortTracker) RemoveListener(_ context.Context, ip net.IP, port int) error {
	addr := ipPortToAddr(ip, port)

	p.mutex.Lock()
	defer p.mutex.Unlock()

	if listener, ok := p.listeners[addr]; ok {
		if err := listener.Close(); err != nil {
			return err
		}

		delete(p.listeners, addr)
	}

	return nil
}

func ipPortToAddr(ip net.IP, port int) string {
	return net.JoinHostPort(ip.String(), strconv.Itoa(port))
}

// Listen on the given address and port.  The returned listener never handles
// any traffic (immediately closing any incoming connection), and tries to
// shutdown quickly when no longer needed.
func listen(ctx context.Context, addr string) (net.Listener, error) {
	config := &net.ListenConfig{
		Control: func(network, address string, c syscall.RawConn) error {
			//nolint:varnamelen // `fd` is the typical name for file descriptor
			err := c.Control(func(fd uintptr) {
				// We should never get any traffic, and should
				// never wait on close; so set linger timeout to
				// 0.  This prevents normal socket close, but
				// that's okay as we don't handle any traffic.
				err := unix.SetsockoptLinger(int(fd), unix.SOL_SOCKET, unix.SO_LINGER, &unix.Linger{
					Onoff:  1,
					Linger: 0,
				})
				if err != nil {
					log.Errorw("failed to set SO_LINGER", log.Fields{
						"error": err,
						"addr":  addr,
						"fd":    fd,
					})
				}
				err = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
				if err != nil {
					log.Errorw("failed to set SO_REUSEADDR", log.Fields{
						"error": err,
						"addr":  addr,
						"fd":    fd,
					})
				}
				err = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
				if err != nil {
					log.Errorw("failed to set SO_REUSEPORT", log.Fields{
						"error": err,
						"addr":  addr,
						"fd":    fd,
					})
				}
			})
			if err != nil {
				return err
			}

			return nil
		},
	}

	listener, err := config.Listen(ctx, "tcp4", addr)
	if err != nil {
		return nil, err
	}

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				if !errors.Is(err, net.ErrClosed) {
					log.Errorw("failed to accept connection", log.Fields{
						"error": err,
						"addr":  addr,
					})
				}

				return
			}
			// We don't handle any traffic; just unceremoniously
			// close the connection and let the other side deal.
			if err = conn.Close(); err != nil {
				log.Errorw("failed to close connection", log.Fields{
					"error": err,
					"addr":  addr,
				})
			}
		}
	}()

	return listener, nil
}
