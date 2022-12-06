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

func FinishShutdown(waitForShutdown bool) error {
	switch runtime.GOOS {
	case "darwin":
		doCheckWithTimeout(checkProcessQemu, pkillQemu, waitForShutdown, 15, 2, "qemu")
		doCheckWithTimeout(checkProcessDarwin, pkillDarwin, waitForShutdown, 5, 1, "the app")
	case "linux":
		doCheckWithTimeout(checkProcessQemu, pkillQemu, waitForShutdown, 15, 2, "qemu")
		doCheckWithTimeout(checkProcessLinux, pkillLinux, waitForShutdown, 5, 1, "the app")
	case "windows":
		doCheckWithTimeout(factoryreset.CheckProcessWindows, factoryreset.KillRancherDesktop, waitForShutdown, 15, 2, "the app")
	default:
		return fmt.Errorf("unhandled runtime: %s", runtime.GOOS)
	}
	return nil
}

func doCheckWithTimeout(checkFunc func() bool, killFunc func(), waitForShutdown bool, retryCount int, retryWait int, operation string) {
	for iter := 0; waitForShutdown && iter < retryCount; iter++ {
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
	cmd := exec.Command("pkill", "-9", "-f", RancherDesktopQemuCommand)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		logrus.Errorf("Failed to kill qemu: %s", err)
	}
}

func pkillDarwin() {
	cmd := exec.Command("/usr/bin/pkill", "-9", "-a", "-l", "-f", "Contents/MacOS/Rancher Desktop")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		logrus.Errorf("Failed to kill Rancher Desktop: %s", err)
	}
}

func pkillLinux() {
	exec.Command("pkill", "-9", "rancher-desktop").Run()
}
