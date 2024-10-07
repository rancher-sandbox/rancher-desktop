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
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.
func TerminateProcessInDirectory(ctx context.Context, directory string) error {
	pids := make([]uint32, 4096)
	// Try EnumProcesses until the number of pids returned is less than the
	// buffer size.
	for {
		var bytesReturned uint32
		err := windows.EnumProcesses(pids, &bytesReturned)
		if err != nil || len(pids) < 1 {
			return fmt.Errorf("failed to enumerate processes: %w", err)
		}
		pidsReturned := uintptr(bytesReturned) / unsafe.Sizeof(pids[0])
		if pidsReturned < uintptr(len(pids)) {
			// Remember to truncate the pids to only the valid set.
			pids = pids[:pidsReturned]
			break
		}
		pids = make([]uint32, len(pids)*2)
	}

	for _, pid := range pids {
		// Do each iteration in a function so defer statements run faster.
		err := (func() error {
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

			nameBuf := make([]uint16, 1024)
			for {
				bufSize := uint32(len(nameBuf))
				err = windows.QueryFullProcessImageName(hProc, 0, &nameBuf[0], &bufSize)
				if err != nil {
					return fmt.Errorf("error getting process %d executable: %w", pid, err)
				}
				if int(bufSize) < len(nameBuf) {
					break
				}
				nameBuf = make([]uint16, len(nameBuf)*2)
			}
			executablePath := windows.UTF16ToString(nameBuf)

			relPath, err := filepath.Rel(directory, executablePath)
			if err != nil || strings.HasPrefix(relPath, "../") {
				return nil
			}

			if err = windows.TerminateProcess(hProc, 0); err != nil {
				return fmt.Errorf("failed to terminate pid %d (%s): %w", pid, executablePath, err)
			}

			return nil
		})()
		if err != nil {
			logrus.Errorf("%s", err)
		}
	}

	return nil
}
