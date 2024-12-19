//go:build linux

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
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"time"

	"github.com/linuxkit/virtsock/pkg/vsock"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/platform"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/util"
)

const (
	// defaultProxyEndpoint is the path on which dockerd should listen on,
	// relative to the WSL mount point.
	defaultProxyEndpoint = "rancher-desktop/run/docker.sock"
	// socketExistTimeout is the time to wait for the docker socket to exist
	socketExistTimeout = 30 * time.Second
	// fileExistSleep is interval to wait while waiting for a file to exist.
	fileExistSleep = 500 * time.Millisecond
)

// waitForFileToExist will block until the given path exists.  If the given
// timeout is reached, an error will be returned.
func waitForFileToExist(filePath string, timeout time.Duration) error {
	timer := time.After(timeout)
	ready := make(chan struct{})
	expired := false

	go func() {
		defer close(ready)
		// We just do polling here, since inotify / fanotify both have fairly
		// low limits on the concurrent number of watchers.
		for !expired {
			_, err := os.Lstat(filePath)
			if err == nil {
				return
			}
			time.Sleep(fileExistSleep)
		}
	}()

	select {
	case <-ready:
		return nil
	case <-timer:
		expired = true
		return fmt.Errorf("timed out waiting for %s to exist", filePath)
	}
}

func GetDefaultProxyEndpoint() (string, error) {
	mountPoint, err := platform.GetWSLMountPoint()
	if err != nil {
		return "", err
	}
	return path.Join(mountPoint, defaultProxyEndpoint), nil
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

	args = append(args,
		fmt.Sprintf("--host=unix://%s", dockerSocket),
		"--host=unix:///var/run/docker.sock")
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
	err = waitForFileToExist(dockerSocket, socketExistTimeout)
	if err != nil {
		return err
	}

	for {
		err := listenOnVsock(port, dockerSocket)
		if err != nil {
			logrus.Fatalf("docker-proxy: error listening on vsock: %s", err)
			break
		}
	}
	return nil
}

func listenOnVsock(port uint32, dockerSocket string) error {
	listener, err := platform.ListenVsockNonBlocking(vsock.CIDAny, port)
	if err != nil {
		return fmt.Errorf("could not listen on vsock port %08x: %w", port, err)
	}
	defer listener.Close()
	logrus.Infof("docker-proxy: listening on vsock port %08x", port)

	sigch := make(chan os.Signal, 1)
	signal.Notify(sigch, unix.SIGTERM)
	go func() {
		<-sigch
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			logrus.Errorf("docker-proxy: error accepting client connection: %s", err)
			if errors.Is(err, unix.EINVAL) {
				// This does not recover; return and re-listen
				return nil
			}
			continue
		}
		go handleConnection(conn, dockerSocket)
	}
}

// handleConnection handles piping the connection from the client to the docker
// socket.
func handleConnection(conn net.Conn, dockerPath string) {
	dockerConn, err := net.Dial("unix", dockerPath)
	if err != nil {
		logrus.Errorf("could not connect to docker: %s", err)
		return
	}
	defer dockerConn.Close()

	// Cast backend and client connections to HalfReadWriteCloser
	var xConn util.HalfReadWriteCloser
	var xDockerConn util.HalfReadWriteCloser
	if x, ok := conn.(util.HalfReadWriteCloser); !ok {
		panic("client connection does not implement HalfReadCloseWriter")
	} else {
		xConn = x
	}
	if x, ok := dockerConn.(util.HalfReadWriteCloser); !ok {
		panic("daemon connection does not implement HalfReadCloseWriter")
	} else {
		xDockerConn = x
	}
	err = util.Pipe(xConn, xDockerConn)
	if err != nil {
		logrus.Errorf("error forwarding docker connection: %s", err)
		return
	}
}
