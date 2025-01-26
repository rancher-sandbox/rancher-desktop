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
	"os/exec"
	"regexp"
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
	vmGUID, err := probeVMGUID(port)
	if err != nil {
		return nil, fmt.Errorf("could not detect WSL2 VM: %w", err)
	}
	dial := func() (net.Conn, error) {
		conn, err := dialHvsock(vmGUID, port)
		if err != nil {
			return nil, err
		}
		return conn, nil
	}
	return dial, nil
}

// dialHvsock creates a net.Conn to a Hyper-V VM running Linux with the given
// GUID, listening on the given vsock port.
func dialHvsock(vmGUID hvsock.GUID, port uint32) (net.Conn, error) {
	// go-winio doesn't implement DialHvsock(), but luckily LinuxKit has an
	// implementation.  We still need go-winio to convert port to GUID.
	svcGUID, err := hvsock.GUIDFromString(winio.VsockServiceID(port).String())
	if err != nil {
		return nil, fmt.Errorf("could not parse Hyper-V service GUID: %w", err)
	}
	addr := hvsock.Addr{
		VMID:      vmGUID,
		ServiceID: svcGUID,
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

	// Configure pipe in MessageMode to support Docker's half-close semantics
	// - Enables zero-byte writes as EOF signals (CloseWrite)
	// - Crucial for stdin stream termination in interactive containers
	pipeConfig := &winio.PipeConfig{MessageMode: true}

	listener, err := winio.ListenPipe(endpoint[len(prefix):], pipeConfig)
	if err != nil {
		return nil, fmt.Errorf("could not listen on %s: %w", endpoint, err)
	}

	return listener, nil
}

// ParseBindString parses a HostConfig.Binds entry, returning the (<host-src> or
// <volume-name>), <container-dest>, and (optional) <options>.  Additionally, it
// also returns a boolean indicating if the first argument is a host path.
func ParseBindString(input string) (string, string, string, bool) {
	// Windows names can be one of a few things:
	// C:\foo\bar                   colon is possible after the drive letter
	// \\?\C:\foo\bar               colon is possible after the drive letter
	// \\server\share\foo           no colons are allowed
	// \\.\pipe\foo                 no colons are allowed
	// Luckily, we only have Linux dockerd, so we only have to worry about
	// Windows-style paths (that may contain colons) in the first part.

	// pathPattern is a RE for the first two options above.
	pathPattern := regexp.MustCompile(`^(?:\\\\\?\\)?.:[^:]*`)
	match := pathPattern.FindString(input)
	if match == "" {
		// The first part is a volume name, a pipe, or other non-path thing.
		firstIndex := strings.Index(input, ":")
		lastIndex := strings.LastIndex(input, ":")
		if firstIndex == lastIndex {
			return input[:firstIndex], input[firstIndex+1:], "", false
		}
		return input[:firstIndex], input[firstIndex+1 : lastIndex], input[lastIndex+1:], false
	} else {
		// The first part is a path.
		rest := input[len(match)+1:]
		index := strings.LastIndex(rest, ":")
		if index > -1 {
			return match, rest[:index], rest[index+1:], true
		}
		return match, rest, "", true
	}
}

func isSlash(input string, indices ...int) bool {
	for _, i := range indices {
		if len(input) <= i || (input[i] != '/' && input[i] != '\\') {
			return false
		}
	}
	return true
}

func IsAbsolutePath(input string) bool {
	if len(input) > 2 && input[1] == ':' && isSlash(input, 2) {
		// C:\
		return true
	}
	if len(input) > 6 && isSlash(input, 0, 1, 3) && input[2] == '?' && input[5] == ':' {
		// \\?\C:\
		return true
	}
	return false
}

// TranslatePathFromClient converts a client path to a path that can be used by
// the docker daemon.
func TranslatePathFromClient(windowsPath string) (string, error) {
	// TODO: See if we can do something faster than shelling out.
	cmd := exec.Command("wsl", "--distribution", "rancher-desktop", "--exec", "/bin/wslpath", "-a", "-u", windowsPath)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("error getting WSL path: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}
