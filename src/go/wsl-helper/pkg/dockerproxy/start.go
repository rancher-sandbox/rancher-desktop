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
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"sync"
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
	// dockerdExitTimeout is the time to wait for dockerd to exit after
	// forwarding a SIGTERM, before giving up and exiting anyway.
	dockerdExitTimeout = 30 * time.Second
	// acceptErrorDelayInitial is the first backoff delay after a failed
	// Accept(); it doubles on every consecutive failure.
	acceptErrorDelayInitial = 10 * time.Millisecond
	// acceptErrorDelayMax caps the Accept() backoff delay.
	acceptErrorDelayMax = time.Second
)

var (
	// listenerMu guards activeListener, so that a close cannot race the
	// re-listen loop and hit a descriptor number that has been recycled.
	listenerMu sync.Mutex
	// activeListener is the vsock listener the SIGTERM handler closes.
	activeListener net.Listener
)

func setActiveListener(listener net.Listener) {
	listenerMu.Lock()
	defer listenerMu.Unlock()
	activeListener = listener
}

// closeActiveListener closes the current vsock listener.  A pending Accept()
// stays blocked, so no caller can wait for the accept loop to return.
func closeActiveListener() {
	listenerMu.Lock()
	defer listenerMu.Unlock()
	if activeListener == nil {
		return
	}
	if err := activeListener.Close(); err != nil {
		logrus.Errorf("docker-proxy: error closing vsock listener: %s", err)
	}
	activeListener = nil
}

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
func Start(ctx context.Context, port uint32, dockerSocket string, args []string) error {
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
		"--host=unix:///var/run/docker.sock.raw",
		"--host=unix:///var/run/docker.sock")
	cmd := exec.CommandContext(ctx, dockerd, args...)
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

	// On SIGTERM, shut down dockerd and exit so that the service supervisor
	// can restart us.  This has to exit the process explicitly: a blocked
	// Accept() on the vsock listener cannot be interrupted, not even by
	// closing the listener.
	sigch := make(chan os.Signal, 1)
	signal.Notify(sigch, unix.SIGTERM)
	go func() {
		<-sigch
		logrus.Info("docker-proxy: shutting down on SIGTERM")
		// Anything accepted from here on would die with this process.
		closeActiveListener()
		if proc := cmd.Process; proc != nil {
			if err := proc.Signal(unix.SIGTERM); err != nil {
				logrus.Errorf("could not stop dockerd: %s", err)
			}
		}
		// Wait for dockerd to exit before we do, so that the supervisor
		// does not start a new dockerd that conflicts with the old one.
		exited := make(chan struct{})
		go func() {
			_ = cmd.Wait()
			close(exited)
		}()
		select {
		case <-exited:
			os.Exit(0)
		case <-time.After(dockerdExitTimeout):
			logrus.Errorf("docker-proxy: dockerd still running %s after SIGTERM; killing it", dockerdExitTimeout)
			if proc := cmd.Process; proc != nil {
				if err := proc.Signal(unix.SIGKILL); err != nil {
					logrus.Errorf("could not kill dockerd: %s", err)
				}
			}
			os.Exit(1)
		}
	}()

	// Wait for the docker socket to exist...
	err = waitForFileToExist(dockerSocket, socketExistTimeout)
	if err != nil {
		return err
	}

	for {
		err := listenOnVsock(ctx, port, dockerSocket)
		if err != nil {
			return fmt.Errorf("docker-proxy: error listening on vsock: %w", err)
		}
		// The listener died; wait a little before creating a new one, so
		// that a persistent failure cannot spin hot.
		time.Sleep(time.Second)
	}
}

func listenOnVsock(ctx context.Context, port uint32, dockerSocket string) error {
	listener, err := platform.ListenVsockNonBlocking(vsock.CIDAny, port)
	if err != nil {
		return fmt.Errorf("could not listen on vsock port %08x: %w", port, err)
	}
	setActiveListener(listener)
	defer closeActiveListener()
	logrus.Infof("docker-proxy: listening on vsock port %08x", port)

	var acceptDelay time.Duration
	for {
		conn, err := listener.Accept()
		if err != nil {
			logrus.Errorf("docker-proxy: error accepting client connection: %s", err)
			if errors.Is(err, unix.EINVAL) || errors.Is(err, unix.EBADF) {
				// The listener does not recover from these; return and re-listen
				return nil
			}
			// Back off so that a persistent error cannot spin hot and grow
			// the log without bound.
			acceptDelay = min(max(2*acceptDelay, acceptErrorDelayInitial), acceptErrorDelayMax)
			time.Sleep(acceptDelay)
			continue
		}
		acceptDelay = 0
		go handleConnection(ctx, conn, dockerSocket)
	}
}

// handleConnection handles piping the connection from the client to the docker
// socket.
func handleConnection(ctx context.Context, conn net.Conn, dockerPath string) {
	dialer := net.Dialer{}
	dockerConn, err := dialer.DialContext(ctx, "unix", dockerPath)
	if err != nil {
		logrus.Errorf("could not connect to docker: %s", err)
		return
	}
	defer dockerConn.Close()

	// Cast both client and docker connections to HalfReadWriteCloser for further handling.
	xConn, ok := conn.(util.HalfReadWriteCloser)
	if !ok {
		logrus.Errorf("client connection does not implement HalfReadWriteCloser")
		return
	}

	xDockerConn, ok := dockerConn.(util.HalfReadWriteCloser)
	if !ok {
		logrus.Errorf("docker connection does not implement HalfReadWriteCloser")
		return
	}

	// Pipe data between the client and Docker, ensuring bidirectional data flow.
	if err := util.Pipe(xConn, xDockerConn); err != nil {
		logrus.Errorf("error forwarding data between client and docker: %s", err)
	}
}
