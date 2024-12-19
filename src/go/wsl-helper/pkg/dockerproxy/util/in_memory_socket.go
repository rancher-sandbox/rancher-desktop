/*
Copyright © 2021 SUSE LLC

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

package util

import (
	"errors"
	"net"
	"sync"
)

var errClosed = errors.New("use of closed network connection")

// InMemorySocket implements net.Listener using in-memory only connections.
type InMemorySocket struct {
	chConn  chan net.Conn
	chClose chan struct{}
	mu      sync.Mutex
}

// dummyAddr is used to satisfy net.Addr for the in-mem socket
// it is just stored as a string and returns the string for all calls
type dummyAddr string

// NewInMemorySocket creates an in-memory only net.Listener
// The addr argument can be any string, but is used to satisfy the `Addr()` part
// of the net.Listener interface
func NewInMemorySocket() *InMemorySocket {
	return &InMemorySocket{
		chConn:  make(chan net.Conn, 8),
		chClose: make(chan struct{}),
	}
}

// Addr returns the socket's addr string to satisfy net.Listener
func (s *InMemorySocket) Addr() net.Addr {
	return dummyAddr("in_memory_address")
}

// Accept implements the Accept method in the Listener interface; it waits for the next call and returns a generic Conn.
func (s *InMemorySocket) Accept() (net.Conn, error) {
	select {
	case conn := <-s.chConn:
		return conn, nil
	case <-s.chClose:
		return nil, errClosed
	}
}

// Close closes the listener. It will be unavailable for use once closed.
func (s *InMemorySocket) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.chClose:
	default:
		close(s.chClose)
	}
	return nil
}

// Dial is used to establish a connection with the in-mem server
func (s *InMemorySocket) Dial(network, addr string) (net.Conn, error) {
	srvConn, clientConn := net.Pipe()
	select {
	case s.chConn <- srvConn:
	case <-s.chClose:
		return nil, errClosed
	}

	return clientConn, nil
}

// Network returns the addr string, satisfies net.Addr
func (a dummyAddr) Network() string {
	return string(a)
}

// String returns the string form
func (a dummyAddr) String() string {
	return string(a)
}
