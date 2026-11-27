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
	"fmt"
	"net"
	"os/exec"
	"regexp"
	"strings"

	"github.com/Microsoft/go-winio"
	"github.com/Microsoft/go-winio/pkg/guid"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/util"
)

// DefaultEndpoint is the platform-specific location that dockerd listens on by
// default.
const DefaultEndpoint = "npipe:////./pipe/docker_engine"

// MakeDialer computes the dial function.
func MakeDialer(port uint32) (func(ctx context.Context) (net.Conn, error), error) {
	vmGUID, err := probeVMGUID(port)
	if err != nil {
		return nil, fmt.Errorf("could not detect WSL2 VM: %w", err)
	}
	dial := func(ctx context.Context) (net.Conn, error) {
		// Don't give this dial a timeout of its own.  The guest sets up
		// incoming Hyper-V socket connections one at a time, so during a
		// burst of requests the later connections wait for the earlier ones.
		// The dial still ends when ctx ends; for a proxied request, that
		// happens when the client disconnects.
		return dialHvsock(ctx, vmGUID, port)
	}
	return dial, nil
}

// dialHvsock creates a net.Conn to a Hyper-V VM running Linux with the given
// GUID, listening on the given vsock port.  It returns when ctx ends even if
// the connect is still pending.
func dialHvsock(ctx context.Context, vmGUID guid.GUID, port uint32) (net.Conn, error) {
	addr := &winio.HvsockAddr{
		VMID:      vmGUID,
		ServiceID: winio.VsockServiceID(port),
	}
	conn, err := util.DialCancelable(ctx, func() (net.Conn, error) {
		// winio.Dial cannot abort a pending connect when ctx ends.  On error,
		// return an untyped nil.  A nil *winio.HvsockConn stored in a
		// net.Conn does not compare equal to nil, so DialCancelable may call
		// Close on it, and that panics.
		conn, err := winio.Dial(ctx, addr)
		if err != nil {
			return nil, err
		}
		return conn, nil
	})
	if err != nil {
		return nil, fmt.Errorf("could not dial Hyper-V socket: %w", err)
	}
	return conn, nil
}

// Listen on the given Windows named pipe endpoint.
func Listen(ctx context.Context, endpoint string) (net.Listener, error) {
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
func TranslatePathFromClient(ctx context.Context, windowsPath string) (string, error) {
	// TODO: See if we can do something faster than shelling out.
	cmd := exec.CommandContext(ctx, "wsl", "--distribution", "rancher-desktop", "--exec", "/bin/wslpath", "-a", "-u", windowsPath)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("error getting WSL path: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}
