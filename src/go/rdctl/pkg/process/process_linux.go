/*
Copyright © 2024 SUSE LLC

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

package process

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/sys/unix"
)

// Iterate over all processes, calling a callback function for each process
// found with the pid and the path to the executable.  If the callback function
// returns an error, iteration is immediately stopped.
func iterProcesses(callback func(pid int, executable string) error) error {
	pidfds, err := os.ReadDir("/proc")
	if err != nil {
		return fmt.Errorf("error listing processes: %w", err)
	}
	for _, pidfd := range pidfds {
		if !pidfd.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(pidfd.Name())
		if err != nil {
			continue
		}
		//nolint:gocritic // filepathJoin doesn't like absolute paths
		procPath, err := os.Readlink(filepath.Join("/proc", pidfd.Name(), "exe"))
		if err != nil {
			continue
		}
		if err := callback(pid, procPath); err != nil {
			return err
		}
	}
	return nil
}

// Block and wait for the given process to exit.
func WaitForProcess(pid int) error {
	pidfd, err := unix.PidfdOpen(pid, 0)
	if err != nil {
		return fmt.Errorf("failed to open process %d: %w", pid, err)
	}
	defer func() {
		_ = os.NewFile(uintptr(pidfd), fmt.Sprintf("/proc/%d", pid)).Close()
	}()

	pollFd := unix.PollFd{
		Fd:     int32(pidfd), //nolint:gosec // PIDs aren't that big.
		Events: unix.POLLIN,
	}
	_, err = unix.Poll([]unix.PollFd{pollFd}, -1)
	if err != nil {
		return fmt.Errorf("failed to wait for process %d: %w", pid, err)
	}
	return nil
}
