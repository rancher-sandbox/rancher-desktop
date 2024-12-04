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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// Iterate over all processes, calling a callback function for each process
// found with the process handle and the path to the executable.  If the
// callback function returns an error, iteration is immediately stopped.
func iterProcesses(callback func(proc windows.Handle, executable string) error) error {
	var pids []uint32
	// Try EnumProcesses until the number of pids returned is less than the
	// buffer size.
	err := directories.InvokeWin32WithBuffer(func(size int) error {
		pids = make([]uint32, size)
		var bytesReturned uint32
		err := windows.EnumProcesses(pids, &bytesReturned)
		if err != nil || len(pids) < 1 {
			return fmt.Errorf("failed to enumerate processes: %w", err)
		}
		pidsReturned := uintptr(bytesReturned) / unsafe.Sizeof(pids[0])
		if pidsReturned < uintptr(len(pids)) {
			// Remember to truncate the pids to only the valid set.
			pids = pids[:pidsReturned]
			return nil
		}
		return windows.ERROR_INSUFFICIENT_BUFFER
	})
	if err != nil {
		return fmt.Errorf("could not get process list: %w", err)
	}

	for _, pid := range pids {
		// Do each iteration in a function so defer statements run faster.
		err = (func() error {
			hProc, err := windows.OpenProcess(
				windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE,
				false,
				pid)
			if err != nil {
				logrus.Infof("Ignoring error opening process %d: %s", pid, err)
				return nil
			}
			defer func() {
				_ = windows.CloseHandle(hProc)
			}()

			var executablePath string
			err = directories.InvokeWin32WithBuffer(func(size int) error {
				nameBuf := make([]uint16, size)
				charsWritten := uint32(size)
				err := windows.QueryFullProcessImageName(hProc, 0, &nameBuf[0], &charsWritten)
				if err != nil {
					logrus.Tracef("failed to get image name for pid %d: %s", pid, err)
					return err
				}
				if charsWritten >= uint32(size)-1 {
					return windows.ERROR_INSUFFICIENT_BUFFER
				}
				executablePath = windows.UTF16ToString(nameBuf)
				return nil
			})
			if err != nil {
				logrus.Debugf("failed to get process name of pid %d: %s (skipping)", pid, err)
				return nil
			}

			if err = callback(hProc, executablePath); err != nil {
				return err
			}
			return nil
		})()
		if err != nil {
			return err
		}
	}

	return nil
}

// Find some pid running the given executable.  If not found, return 0.
func FindPidOfProcess(executable string) (int, error) {
	targetInfo, err := os.Stat(executable)
	if err != nil {
		return 0, fmt.Errorf("failed to determine %s info: %w", executable, err)
	}

	var mainPid int
	// errFound is a sentinel error so we can break out of the loop early.
	errFound := fmt.Errorf("found Rancher Desktop process")
	err = iterProcesses(func(proc windows.Handle, executable string) error {
		pid, err := windows.GetProcessId(proc)
		if err != nil {
			return fmt.Errorf("failed to get pid of process %s", executable)
		}
		info, err := os.Stat(executable)
		if err != nil {
			// Maybe the executable has been deleted since.
			logrus.Debugf("failed to look up executable for pid %d: %s", pid, err)
			return nil
		}
		if os.SameFile(targetInfo, info) {
			mainPid = int(pid)
			return errFound
		}
		return nil
	})
	if err != nil && !errors.Is(err, errFound) {
		return 0, err
	}
	return mainPid, nil
}

// Wait for the process identified by the given pid to exit, then kill all
// processes in the same process group.  This blocks until the given process
// exits.
func WaitForProcessAndKillGroup(pid int) error {
	return errors.New("WaitForProcessAndKillGroup is not implemented on Windows")
}

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.  The `force`
// parameter is unused on Windows.
func TerminateProcessInDirectory(directory string, force bool) error {
	return iterProcesses(func(proc windows.Handle, executablePath string) error {
		pid, err := windows.GetProcessId(proc)
		if err != nil {
			pid = 0
		}
		relPath, err := filepath.Rel(directory, executablePath)
		if err != nil {
			// This may be because they're on different drives, network shares, etc.
			logrus.Tracef("failed to make pid %d image %s relative to %s: %s", pid, executablePath, directory, err)
			return nil
		}
		if strings.HasPrefix(relPath, "..") {
			// Relative path includes "../" prefix, not a child of given directory.
			logrus.Tracef("skipping pid %d (%s), not in %s", pid, executablePath, directory)
			return nil
		}

		logrus.Tracef("will terminate pid %d image %s", pid, executablePath)
		if err = windows.TerminateProcess(proc, 0); err != nil {
			logrus.Errorf("failed to terminate pid %d (%s): %s", pid, executablePath, err)
		}
		return nil
	})
}
