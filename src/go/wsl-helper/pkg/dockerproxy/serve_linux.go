//go:build linux || windows
// +build linux windows

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
)

// DefaultEndpoint is the platform-specific location that dockerd listens on by
// default.
const DefaultEndpoint = "unix:///var/run/docker.sock"

// errListenerClosed is the error that is returned when we attempt to call
// Accept() on a closed listener.
var errListenerClosed = net.ErrClosed

// Serve up the docker proxy at the given endpoint, forwarding to the underlying
// docker server at the given unix socket.
func Serve(endpoint, proxyEndpoint string) error {
	dialer := func() (net.Conn, error) {
		conn, err := net.Dial("unix", proxyEndpoint)
		if err != nil {
			return nil, err
		}
		return conn, nil
	}
	return serve(endpoint, dialer)
}

// listen on the given Unix socket endpoint.
func listen(endpoint string) (net.Listener, error) {
	prefix := "unix://"
	if !strings.HasPrefix(endpoint, prefix) {
		return nil, fmt.Errorf("endpoint %s does not start with protocol %s", endpoint, prefix)
	}

	addr, err := net.ResolveUnixAddr("unix", endpoint[len(prefix):])
	if err != nil {
		return nil, fmt.Errorf("could not resolve endpoint %s: %w", endpoint, err)
	}

	listener, err := net.ListenUnix("unix", addr)
	if err != nil {
		return nil, fmt.Errorf("could not listen on %s: %w", endpoint, err)
	}

	return listener, nil
}
