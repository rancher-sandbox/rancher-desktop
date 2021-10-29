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

package dockerproxy

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

// errListenerClosed is the error that is returned when we attempt to call
// Accept() on a closed listener.
var errListenerClosed = winio.ErrPipeListenerClosed

// Serve up the docker proxy at the given endpoint, forwarding to the underlying
// docker server at the given vsock port.
func Serve(endpoint string, port uint32) error {
	return serve(endpoint, makeDialer(port))
}

// makeDialer creates the dialer function to create a vsock connection on the
// given port.
func makeDialer(port uint32) func() (net.Conn, error) {
	return func() (net.Conn, error) {
		// go-winio doesn't implement DialHvsock(), but luckily LinuxKit has an
		// implementation.  We still need go-winio to convert port to GUID.
		vmGuid, err := hvsock.GUIDFromString("ADC5B3E0-AFAB-4D8B-8139-FAF16CE7B463")
		if err != nil {
			return nil, fmt.Errorf("could not parse WSL VM GUID: %w", err)
		}
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
}

// listen on the given Windows named pipe endpoint.
func listen(endpoint string) (net.Listener, error) {
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
