/*
Copyright © 2022 SUSE LLC

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

package shutdown

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/sirupsen/logrus"
)

func FinishShutdown() error {
	switch runtime.GOOS {
	case "darwin":
		doCheckWithTimeout(checkProcessQemu, pkillQemu, 15, 2, "qemu")
		doCheckWithTimeout(checkProcessDarwin, pkillDarwin, 5, 1, "the app")
	case "linux":
		doCheckWithTimeout(checkProcessQemu, pkillQemu, 15, 2, "qemu")
		doCheckWithTimeout(checkProcessLinux, pkillLinux, 5, 1, "the app")
	case "windows":
		doCheckWithTimeout(checkProcessWindows, factoryreset.KillRancherDesktop, 15, 2, "the app")
	default:
		return fmt.Errorf("unhandled runtime: %s", runtime.GOOS)
	}
	return nil
}

func doCheckWithTimeout(checkFunc func() bool, killFunc func(), retryCount int, retryWait int, operation string) {
	for iter := 0; iter < retryCount; iter++ {
		if iter > 0 {
			logrus.Debugf("checking %s showed it's still running; sleeping %d seconds\n", operation, retryWait)
			time.Sleep(time.Duration(retryWait) * time.Second)
		}
		if !checkFunc() {
			logrus.Debugf("%s is no longer running\n", operation)
			return
		}
	}
	logrus.Debugf("About to force-kill %s\n", operation)
	killFunc()
}

/**
 * checkProcessX function returns true if it detects the app is still running, false otherwise
 */

func checkProcessDarwin() bool {
	return checkProcessLinuxLike("-f", "Contents/MacOS/Rancher Desktop")
}

func checkProcessLinux() bool {
	return checkProcessLinuxLike("rancher-desktop")
}

func checkProcessWindows() bool {
	path, err := directories.GetLockfilePath("rancher-desktop")
	if err != nil {
		logrus.Errorf("Error trying to get the lockfile path: %s\n", err)
		return false
	}
	logrus.Debugf("GetLockfilePath => %s\n", path)
	if _, err = os.Stat(path); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logrus.Errorf("Error trying to stat %s: %s\n", path, err)
		}
		// File either no longer exists or isn't "stat-table"
		return false
	}
	return true
}

func checkProcessLinuxLike(commandPattern ...string) bool {
	result, err := exec.Command("pgrep", commandPattern...).CombinedOutput()
	if err != nil {
		return false
	}
	ptn, err := regexp.Compile(`\A[0-9\s]+\z`)
	if err != nil {
		logrus.WithField("error", err).Warn("failed to compile pattern")
		return false
	}
	return ptn.Match(result)
}

// RancherDesktopQemuCommand - be specific to avoid killing other VM-based processes running qemu
const RancherDesktopQemuCommand = "lima/bin/qemu-system.*rancher-desktop/lima/[0-9]/diffdisk"

func checkProcessQemu() bool {
	return checkProcessLinuxLike("-f", RancherDesktopQemuCommand)
}

func pkillQemu() {
	exec.Command("pkill", "-f", RancherDesktopQemuCommand).Run()
}

func pkillDarwin() {
	exec.Command("pkill", "-f", "Contents/MacOS/Rancher Desktop").Run()
}

func pkillLinux() {
	exec.Command("pkill", "rancher-desktop").Run()
}
