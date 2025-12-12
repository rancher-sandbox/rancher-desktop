package platform

// This file contains extensions to vsock handling on Linux.  This is derived
// from github.com/linuxkit/virtsock/pkg/vsock.

/**
 * Copyright 2016-2017 The authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import (
	"fmt"
	"net"
	"os"
	"syscall"
	"time"

	"github.com/linuxkit/virtsock/pkg/vsock"
	"github.com/pkg/errors"
	"golang.org/x/sys/unix"
)

// Convert a generic unix.Sockaddr to a Addr
func sockaddrToVsock(sa unix.Sockaddr) *vsock.Addr {
	if vmAddr, ok := sa.(*unix.SockaddrVM); ok {
		return &vsock.Addr{CID: vmAddr.CID, Port: vmAddr.Port}
	}
	return nil
}

// ListenVsockNonBlocking returns a net.Listener which can accept connections on the given port, returning non-blocking connections.
func ListenVsockNonBlocking(cid, port uint32) (net.Listener, error) {
	fd, err := syscall.Socket(unix.AF_VSOCK, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}

	sa := &unix.SockaddrVM{CID: cid, Port: port}
	if err = unix.Bind(fd, sa); err != nil {
		return nil, errors.Wrapf(err, "bind() to %08x.%08x failed", cid, port)
	}

	err = syscall.Listen(fd, syscall.SOMAXCONN)
	if err != nil {
		return nil, errors.Wrapf(err, "listen() on %08x.%08x failed", cid, port)
	}
	return &vsockListener{fd, vsock.Addr{CID: cid, Port: port}}, nil
}

type vsockListener struct {
	fd    int
	local vsock.Addr
}

// Accept accepts an incoming call and returns the new connection.
func (v *vsockListener) Accept() (net.Conn, error) {
	fd, sa, err := unix.Accept4(v.fd, unix.SOCK_NONBLOCK)
	if err != nil {
		return nil, fmt.Errorf("error accept()ing connection: %w", err)
	}
	return newVsockConn(uintptr(fd), &v.local, sockaddrToVsock(sa)), nil
}

// Close closes the listening connection
func (v *vsockListener) Close() error {
	// Note this won't cause the Accept to unblock.
	return unix.Close(v.fd)
}

// Addr returns the address listened to by the Listener
func (v *vsockListener) Addr() net.Addr {
	return v.local
}

// a wrapper around FileConn which supports CloseRead and CloseWrite
type vsockConn struct {
	vsock  *os.File
	fd     uintptr
	local  *vsock.Addr
	remote *vsock.Addr
}

func newVsockConn(fd uintptr, local, remote *vsock.Addr) *vsockConn {
	socketFile := os.NewFile(fd, fmt.Sprintf("vsock:%d", fd))
	return &vsockConn{vsock: socketFile, fd: fd, local: local, remote: remote}
}

// LocalAddr returns the local address of a connection
func (v *vsockConn) LocalAddr() net.Addr {
	return v.local
}

// RemoteAddr returns the remote address of a connection
func (v *vsockConn) RemoteAddr() net.Addr {
	return v.remote
}

// Close closes the connection
func (v *vsockConn) Close() error {
	return v.vsock.Close()
}

// CloseRead shuts down the reading side of a vsock connection
func (v *vsockConn) CloseRead() error {
	return syscall.Shutdown(int(v.fd), syscall.SHUT_RD)
}

// CloseWrite shuts down the writing side of a vsock connection
func (v *vsockConn) CloseWrite() error {
	return syscall.Shutdown(int(v.fd), syscall.SHUT_WR)
}

// Read reads data from the connection
func (v *vsockConn) Read(buf []byte) (int, error) {
	return v.vsock.Read(buf)
}

// Write writes data over the connection
func (v *vsockConn) Write(buf []byte) (int, error) {
	return v.vsock.Write(buf)
}

// SetDeadline sets the read and write deadlines associated with the connection
func (v *vsockConn) SetDeadline(t time.Time) error {
	return nil // FIXME
}

// SetReadDeadline sets the deadline for future Read calls.
func (v *vsockConn) SetReadDeadline(t time.Time) error {
	return nil // FIXME
}

// SetWriteDeadline sets the deadline for future Write calls
func (v *vsockConn) SetWriteDeadline(t time.Time) error {
	return nil // FIXME
}

// File duplicates the underlying socket descriptor and returns it.
func (v *vsockConn) File() (*os.File, error) {
	// This is equivalent to dup(2) but creates the new fd with CLOEXEC already set.
	r0, _, e1 := syscall.Syscall(syscall.SYS_FCNTL, v.vsock.Fd(), syscall.F_DUPFD_CLOEXEC, 0)
	if e1 != 0 {
		return nil, os.NewSyscallError("fcntl", e1)
	}
	return os.NewFile(r0, v.vsock.Name()), nil
}
