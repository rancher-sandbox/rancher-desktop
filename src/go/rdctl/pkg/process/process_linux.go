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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"
)

// TerminateProcessInDirectory terminates all processes where the executable
// resides within the given directory, as gracefully as possible.
func TerminateProcessInDirectory(ctx context.Context, directory string) error {
	// Check /proc/<pid>/exe to see if they're the correct file.
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
		procPath, err := os.Readlink(filepath.Join("/proc", pidfd.Name(), "exe"))
		if err != nil {
			continue
		}
		relPath, err := filepath.Rel(directory, procPath)
		if err != nil || strings.HasPrefix(relPath, "../") {
			continue
		}
		proc, err := os.FindProcess(pid)
		if err != nil {
			continue
		}
		err = proc.Signal(unix.SIGTERM)
		if err == nil {
			logrus.Infof("Terminated process %d (%s)", pid, procPath)
		} else if !errors.Is(err, unix.EINVAL) {
			logrus.Infof("Ignoring failure to terminate pid %d (%s): %s", pid, procPath, err)
		}
	}

	return nil
}
