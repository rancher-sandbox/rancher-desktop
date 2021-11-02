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

package platform

import (
	"fmt"
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
	"github.com/linuxkit/virtsock/pkg/hvsock"
)

// DefaultEndpoint is the platform-specific location that dockerd listens on by
// default.
const DefaultEndpoint = "npipe:////./pipe/docker_engine"

// ErrListenerClosed is the error that is returned when we attempt to call
// Accept() on a closed listener.
var ErrListenerClosed = winio.ErrPipeListenerClosed

// MakeDialer computes the dial function.
func MakeDialer(port uint32) (func() (net.Conn, error), error) {
	vmGuid, err := probeVMGUID(port)
	if err != nil {
		return nil, fmt.Errorf("could not detect WSL2 VM: %w", err)
	}
	dial := func() (net.Conn, error) {
		conn, err := dialHvsock(vmGuid, port)
		if err != nil {
			return nil, err
		}
		return conn, nil
	}
	return dial, nil
}

// dialHvsock creates a net.Conn to a Hyper-V VM running Linux with the given
// GUID, listening on the given vsock port.
func dialHvsock(vmGuid hvsock.GUID, port uint32) (net.Conn, error) {
	// go-winio doesn't implement DialHvsock(), but luckily LinuxKit has an
	// implementation.  We still need go-winio to convert port to GUID.
	svcGuid, err := hvsock.GUIDFromString(winio.VsockServiceID(port).String())
	if err != nil {
		return nil, fmt.Errorf("could not parse Hyper-V service GUID: %w", err)
	}
	addr := hvsock.Addr{
		VMID:      vmGuid,
		ServiceID: svcGuid,
	}

	conn, err := hvsock.Dial(addr)
	if err != nil {
		return nil, fmt.Errorf("could not dial Hyper-V socket: %w", err)
	}

	return conn, nil
}

// Listen on the given Windows named pipe endpoint.
func Listen(endpoint string) (net.Listener, error) {
	const prefix = "npipe://"

	if !strings.HasPrefix(endpoint, prefix) {
		return nil, fmt.Errorf("endpoint %s does not start with protocol %s", endpoint, prefix)
	}

	listener, err := winio.ListenPipe(endpoint[len(prefix):], nil)
	if err != nil {
		return nil, fmt.Errorf("could not listen on %s: %w", endpoint, err)
	}

	return listener, nil
}
