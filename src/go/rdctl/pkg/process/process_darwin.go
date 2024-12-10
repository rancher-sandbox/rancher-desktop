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
	"slices"
	"strings"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"
)

const (
	CTL_KERN      = "kern"
	KERN_PROCARGS = 38
)

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.  If `force` is
// set, SIGKILL is used instead.
func TerminateProcessInDirectory(directory string, force bool) error {
	procs, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return fmt.Errorf("failed to list processes: %w", err)
	}
	for _, proc := range procs {
		pid := int(proc.Proc.P_pid)
		// Don't kill the current process
		if pid == os.Getpid() {
			continue
		}
		buf, err := unix.SysctlRaw(CTL_KERN, KERN_PROCARGS, pid)
		if err != nil {
			if !errors.Is(err, unix.EINVAL) {
				logrus.Infof("Failed to get command line of pid %d: %s", pid, err)
			}
			continue
		}
		// The buffer starts with a null-terminated executable path, plus
		// command line arguments and things.
		index := slices.Index(buf, 0)
		if index < 0 {
			// If we have unexpected data, don't fall over.
			continue
		}
		procPath := string(buf[:index])
		relPath, err := filepath.Rel(directory, procPath)
		if err != nil || strings.HasPrefix(relPath, "../") {
			continue
		}
		process, err := os.FindProcess(pid)
		if err != nil {
			continue
		}
		if force {
			err = process.Signal(unix.SIGKILL)
		} else {
			err = process.Signal(unix.SIGTERM)
		}
		if err == nil {
			logrus.Infof("Terminated process %d (%s)", pid, procPath)
		} else if !errors.Is(err, unix.EINVAL) {
			logrus.Infof("Ignoring failure to terminate pid %d (%s): %s", pid, procPath, err)
		}
	}
	return nil
}

// Block and wait for the given process to exit.
func WaitForProcess(pid int) error {
	queue, err := unix.Kqueue()
	if err != nil {
		return fmt.Errorf("failed to initialize process monitoring: %w", err)
	}
	defer func() {
		if err := unix.Close(queue); err != nil {
			logrus.Warnf("Ignoring failure to close kqueue: %s", err)
		}
	}()
	change := unix.Kevent_t{
		Ident:  uint64(pid),
		Filter: unix.EVFILT_PROC,
		Flags:  unix.EV_ADD | unix.EV_ENABLE | unix.EV_ONESHOT,
		Fflags: unix.NOTE_EXIT,
	}
	events := make([]unix.Kevent_t, 1)
	n, err := unix.Kevent(queue, []unix.Kevent_t{change}, events, nil)
	if err != nil {
		return fmt.Errorf("failed to wait for process %d to exit: %w", pid, err)
	}
	logrus.Tracef("got %d kqueue events: %+v", n, events[:n])
	return nil
}
