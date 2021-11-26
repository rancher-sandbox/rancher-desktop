//go:build linux
// +build linux

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
	"os"
	"os/exec"
	"os/signal"
	"path"
	"time"

	"github.com/linuxkit/virtsock/pkg/vsock"
	"golang.org/x/sys/unix"

	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy/util"
)

// DefaultProxyEndpoint is the path on which dockerd should listen on.
const DefaultProxyEndpoint = "/mnt/wsl/rancher-desktop/run/docker.sock"

// waitForFileToExist will block until the given path exists.  If the given
// timeout is reached, an error will be returned.
func waitForFileToExist(path string, timeout time.Duration) error {
	timer := time.After(timeout)
	ready := make(chan struct{})
	expired := false

	go func() {
		defer close(ready)
		// We just do polling here, since inotify / fanotify both have fairly
		// low limits on the concurrent number of watchers.
		for !expired {
			_, err := os.Lstat(path)
			if err == nil {
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()

	select {
	case <-ready:
		return nil
	case <-timer:
		expired = true
		return fmt.Errorf("timed out waiting for %s to exist", path)
	}
}

// Start the dockerd process within this WSL distribution on the given vsock
// port as well as the unix socket at the given path.  All other arguments are
// passed to dockerd as-is.
//
// This function returns after dockerd has exited.
func Start(port uint32, dockerSocket string, args []string) error {
	dockerd, err := exec.LookPath("dockerd")
	if err != nil {
		return fmt.Errorf("could not find dockerd: %w", err)
	}

	// We have dockerd listen on the given docker socket, so that it can be
	// used from other distributions (though we still need to do path
	// path translation on top).

	err = os.MkdirAll(path.Dir(dockerSocket), 0o755)
	if err != nil {
		return fmt.Errorf("could not set up docker socket: %w", err)
	}

	args = append(args, fmt.Sprintf("--host=unix://%s", dockerSocket))
	args = append(args, "--host=unix:///var/run/docker.sock")
	cmd := exec.Command(dockerd, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err = cmd.Start()
	if err != nil {
		return fmt.Errorf("could not start dockerd: %w", err)
	}

	defer func() {
		if proc := cmd.Process; proc != nil {
			err := proc.Signal(unix.SIGTERM)
			if err != nil {
				fmt.Printf("could not kill docker: %s\n", err)
			}
		}
	}()

	// Wait for the docker socket to exist...
	err = waitForFileToExist(dockerSocket, 30*time.Second)
	if err != nil {
		return err
	}

	listener, err := vsock.Listen(vsock.CIDAny, port)
	if err != nil {
		return fmt.Errorf("could not listen on vsock port %08x: %w", port, err)
	}
	defer listener.Close()

	sigch := make(chan os.Signal)
	signal.Notify(sigch, unix.SIGTERM)
	go func() {
		<-sigch
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			fmt.Printf("error accepting client connection: %s\n", err)
			continue
		}
		go handleConnection(conn, dockerSocket)
	}

	return nil
}

// handleConnection handles piping the connection from the client to the docker
// socket.
func handleConnection(conn net.Conn, dockerPath string) {
	dockerConn, err := net.Dial("unix", dockerPath)
	if err != nil {
		fmt.Printf("could not connect to docker: %s\n", err)
		return
	}
	defer dockerConn.Close()
	err = util.Pipe(conn, dockerConn)
	if err != nil {
		fmt.Printf("error forwarding docker connection: %s\n", err)
		return
	}
}
