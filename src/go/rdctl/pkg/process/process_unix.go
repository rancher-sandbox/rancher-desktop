//go:build unix

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
	"runtime"
	"strings"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"
)

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.  If `force` is
// set, SIGKILL is used instead.
func TerminateProcessInDirectory(directory string, force bool) error {
	return iterProcesses(func(pid int, procPath string) error {
		// Don't kill the current process
		if pid == os.Getpid() {
			return nil
		}
		relPath, err := filepath.Rel(directory, procPath)
		if err != nil || strings.HasPrefix(relPath, "../") {
			return nil
		}
		proc, err := os.FindProcess(pid)
		if err != nil {
			return nil
		}
		if force {
			err = proc.Signal(unix.SIGKILL)
		} else {
			err = proc.Signal(unix.SIGTERM)
		}
		if err == nil {
			logrus.Infof("Terminated process %d (%s)", pid, procPath)
		} else if !errors.Is(err, unix.EINVAL) {
			logrus.Infof("Ignoring failure to terminate pid %d (%s): %s", pid, procPath, err)
		}
		return nil
	})
}

// Find some pid running the given executable.  If not found, return 0.
func FindPidOfProcess(executable string) (int, error) {
	targetInfo, err := os.Stat(executable)
	if err != nil {
		return 0, fmt.Errorf("failed to determine %s info: %w", executable, err)
	}

	var mainPid int
	// errFound is a sentinel error so we can break out of the loop early.
	errFound := fmt.Errorf("found executable process")
	err = iterProcesses(func(pid int, executable string) error {
		info, err := os.Stat(executable)
		if err != nil {
			// Maybe the executable has been deleted since.
			logrus.Debugf("failed to look up executable for pid %d: %s", pid, err)
			return nil
		}
		if os.SameFile(targetInfo, info) {
			mainPid = pid
			return errFound
		}
		return nil
	})
	if err != nil && !errors.Is(err, errFound) {
		return 0, err
	}
	return mainPid, nil
}

// Kill the process group the given process belongs to.  If wait is set, block
// until the target process exits first before doing so.  On Linux, the process
// group is only killed if the given pid is its own process group leader.
func KillProcessGroup(pid int, wait bool) error {
	if pid == 0 {
		return nil
	}
	pgid, err := unix.Getpgid(pid)
	if err != nil {
		return fmt.Errorf("failed to get process group id for %d: %w", pid, err)
	}
	if wait {
		if err = WaitForProcess(pid); err != nil {
			return fmt.Errorf("failed to wait for process: %w", err)
		}
	}
	if runtime.GOOS == "linux" && pid != pgid {
		// On Linux, do not kill the process group if the pid is not the same as
		// the process group id; this can happen when running from rpm/deb
		// packaged builds (in which case killing the process group ends up
		// killing the whole X11 session).
		return nil
	}
	err = unix.Kill(-pgid, unix.SIGTERM)
	if err != nil && !errors.Is(err, unix.ESRCH) {
		return fmt.Errorf("failed to send SIGTERM: %w", err)
	}

	return nil
}
