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
	"os"
	"os/exec"

	"golang.org/x/sys/unix"
)

// sdListenFdsStart is SD_LISTEN_FDS_START from sd_listen_fds(3)
const sdListenFdsStart = 3

// Start the dockerd process within this WSL distribution on the given vsock
// port.  All other arguments are passed to dockerd as-is.
//
// On success, this function never returns; the current process is replaced by
// the dockerd process directly.
func Start(port uint32, args []string) error {
	dockerd, err := exec.LookPath("dockerd")
	if err != nil {
		return fmt.Errorf("could not find dockerd: %w", err)
	}

	// We can't use github.com/linuxkit/virtsock/pkg/vsock here, as it opens
	// things as CLOEXEC (also we can't get the fd out).
	fd, err := unix.Socket(unix.AF_VSOCK, unix.SOCK_STREAM, 0)
	if err != nil {
		return fmt.Errorf("could not create vsock socket: %w", err)
	}

	// As we never exit (in the successful case), we can defer to close the
	// vsock here.
	defer unix.Close(fd)

	if port == 0 {
		port = unix.VMADDR_PORT_ANY
	}
	vmsockaddr := &unix.SockaddrVM{CID: unix.VMADDR_CID_ANY, Port: port}


	err = unix.Bind(fd, vmsockaddr)
	if err != nil {
		return fmt.Errorf("could not bind to vsock %+v: %w", vmsockaddr, err)
	}

	err = unix.Listen(fd, unix.SOMAXCONN)
	if err != nil {
		return fmt.Errorf("could not listen on vsock: %w", err)
	}

	sockaddr, err := unix.Getsockname(fd)
	if err != nil {
		return fmt.Errorf("could not get bound sockaddr: %w", err)
	}
	fmt.Printf("docker proxy listening on port %x\n", sockaddr.(*unix.SockaddrVM).Port)

	pollfds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN|unix.POLLOUT}}
	n, err := unix.Poll(pollfds, -1)
	if err != nil {
		return fmt.Errorf("could not poll vsock: %w", err)
	}

	fmt.Printf("poll returned %d: %+v\n", n, pollfds)

	args = append([]string{dockerd}, args...)
	args = append(args, fmt.Sprintf("--host=fd://%d", fd))
	err = os.Setenv("LISTEN_PID", fmt.Sprintf("%d", os.Getpid()))
	if err != nil {
		return fmt.Errorf("could not set environment variable LISTEN_PID: %w", err)
	}
	err = os.Setenv("LISTEN_FDS", fmt.Sprintf("%d", fd - sdListenFdsStart + 1))
	if err != nil {
		return fmt.Errorf("could not set environment variable LISTEN_FDS: %w", err)
	}

	err = unix.Exec(dockerd, args, os.Environ())
	if err != nil {
		return fmt.Errorf("could not run docker: %w", err)
	}

	panic("unix.Exec() should not return")
}
