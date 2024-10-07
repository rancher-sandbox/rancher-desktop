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
	"strings"
	"unsafe"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.  If `force` is
// set, SIGKILL is used instead.
func TerminateProcessInDirectory(directory string, force bool) error {
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
		// Don't kill the current process
		if pid == uint32(os.Getpid()) {
			continue
		}
		// Do each iteration in a function so defer statements run faster.
		(func() {
			hProc, err := windows.OpenProcess(
				windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE,
				false,
				pid)
			if err != nil {
				logrus.Infof("Ignoring error opening process %d: %s", pid, err)
				return
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
				return
			}

			relPath, err := filepath.Rel(directory, executablePath)
			if err != nil {
				// This may be because they're on different drives, network shares, etc.
				logrus.Tracef("failed to make pid %d image %s relative to %s: %s", pid, executablePath, directory, err)
				return
			}
			if strings.HasPrefix(relPath, "..") {
				// Relative path includes "../" prefix, not a child of given directory.
				logrus.Tracef("skipping pid %d (%s), not in %s", pid, executablePath, directory)
				return
			}

			logrus.Tracef("will terminate pid %d image %s", pid, executablePath)
			if err = windows.TerminateProcess(hProc, 0); err != nil {
				logrus.Errorf("failed to terminate pid %d (%s): %s", pid, executablePath, err)
			}
		})()
	}

	return nil
}
