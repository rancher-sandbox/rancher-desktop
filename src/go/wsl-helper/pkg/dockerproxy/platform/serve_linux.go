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
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"syscall"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"
)

// DefaultEndpoint is the platform-specific location that dockerd listens on by
// default.
const DefaultEndpoint = "unix:///var/run/docker.sock"

// ErrListenerClosed is the error that is returned when we attempt to call
// Accept() on a closed listener.
var ErrListenerClosed = net.ErrClosed

// MakeDialer computes the dial function.
func MakeDialer(proxyEndpoint string) (func(ctx context.Context) (net.Conn, error), error) {
	dialer := net.Dialer{}
	return func(ctx context.Context) (net.Conn, error) {
		conn, err := dialer.DialContext(ctx, "unix", proxyEndpoint)
		if err != nil {
			return nil, err
		}
		return conn, nil
	}, nil
}

// Listen on the given Unix socket endpoint.
func Listen(ctx context.Context, endpoint string) (net.Listener, error) {
	prefix := "unix://"
	if !strings.HasPrefix(endpoint, prefix) {
		return nil, fmt.Errorf("endpoint %s does not start with protocol %s", endpoint, prefix)
	}

	filepath := endpoint[len(prefix):]
	addr, err := net.ResolveUnixAddr("unix", filepath)
	if err != nil {
		return nil, fmt.Errorf("could not resolve endpoint %s: %w", endpoint, err)
	}

	// First, try to connect to it; if it's connection refused, then the socket
	// file exists but nobody is listening, in which case we can delete it.
	dialer := net.Dialer{}
	conn, err := dialer.DialContext(ctx, "unix", filepath)
	if err != nil {
		if errors.Is(err, syscall.ECONNREFUSED) {
			if err = os.Remove(filepath); err != nil {
				logrus.WithError(err).WithField("path", filepath).Debug("could not remove dead socket, ignoring.")
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			logrus.WithError(err).Debug("unexpected error connecting to existing socket, ignoring.")
		}
	} else {
		conn.Close()
		// Another process is listening; we'll just continue and let ListenUnix
		// fail and return an error.
	}

	listener, err := net.ListenUnix("unix", addr)
	if err != nil {
		return nil, fmt.Errorf("could not listen on %s: %w", endpoint, err)
	}

	success := false
	defer func() {
		if !success {
			listener.Close()
		}
	}()

	var stat unix.Stat_t
	err = unix.Stat(filepath, &stat)
	if err != nil {
		return nil, fmt.Errorf("could not get socket %s permissions: %w", filepath, err)
	}

	desiredPerms := os.FileMode(stat.Mode | 0o777)
	err = os.Chmod(filepath, desiredPerms)
	if err != nil {
		return nil, fmt.Errorf("could not change socket %s permissions: %w", filepath, err)
	}

	success = true
	return listener, nil
}

// ParseBindString parses a HostConfig.Binds entry, returning the (<host-src> or
// <volume-name>), <container-dest>, and (optional) <options>.  Additionally, it
// also returns a boolean indicating if the first argument is a host path.
func ParseBindString(input string) (string, string, string, bool) {
	// The volumes here are [<host-src>:]<container-dest>[:options]
	// For a first pass, let's just assume there are no colons in any of this...
	// The API spec says that if the first part is a host path, then it _must_
	// be absolute.
	hostIsPath := strings.HasPrefix(input, "/")
	firstIndex := strings.Index(input, ":")
	lastIndex := strings.LastIndex(input, ":")
	if firstIndex < 0 {
		// just /foo -- map the same path on the host to the container.
		return input, input, "", hostIsPath
	}
	start := input[:firstIndex]
	end := input[lastIndex+1:]
	if lastIndex > firstIndex {
		// /foo:/bar:ro
		middle := input[firstIndex+1 : lastIndex]
		return start, middle, end, hostIsPath
	}
	// either /foo:/bar or /foo:ro
	if strings.HasPrefix(end, "/") {
		return start, end, "", hostIsPath
	}
	return start, start, end, hostIsPath
}
