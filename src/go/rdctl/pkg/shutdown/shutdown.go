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

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/sirupsen/logrus"
)

type ShutdownInfo struct {
	waitForShutdown bool
}

func NewShutdownInfo(waitForShutdown bool) *ShutdownInfo {
	return &ShutdownInfo{waitForShutdown: waitForShutdown}
}

func (s *ShutdownInfo) FinishShutdown() error {
	var err error

	switch runtime.GOOS {
	case "darwin":
		if err = s.waitForAppToDieOrKillIt(checkProcessQemu, pkillQemu, 15, 2, "qemu"); err != nil {
			return err
		}
		if err = s.waitForAppToDieOrKillIt(checkProcessDarwin, pkillDarwin, 5, 1, "the app"); err != nil {
			return err
		}
	case "linux":
		if err = s.waitForAppToDieOrKillIt(checkProcessQemu, pkillQemu, 15, 2, "qemu"); err != nil {
			return err
		}
		if err = s.waitForAppToDieOrKillIt(checkProcessLinux, pkillLinux, 5, 1, "the app"); err != nil {
			return err
		}
	case "windows":
		if err = s.waitForAppToDieOrKillIt(factoryreset.CheckProcessWindows, factoryreset.KillRancherDesktop, 15, 2, "the app"); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unhandled runtime: %s", runtime.GOOS)
	}
	return nil
}

func (s *ShutdownInfo) waitForAppToDieOrKillIt(checkFunc func() (bool, error), killFunc func() error, retryCount int, retryWait int, operation string) error {
	for iter := 0; s.waitForShutdown && iter < retryCount; iter++ {
		if iter > 0 {
			logrus.Debugf("checking %s showed it's still running; sleeping %d seconds\n", operation, retryWait)
			time.Sleep(time.Duration(retryWait) * time.Second)
		}
		status, err := checkFunc()
		if err != nil {
			return fmt.Errorf("checking operation %s => error %w", err)
		} else if !status {
			logrus.Debugf("%s is no longer running\n", operation)
			return nil
		}
	}
	logrus.Debugf("About to force-kill %s\n", operation)
	return killFunc()
}

/**
 * checkProcessX function returns true if it detects the app is still running, false otherwise
 */

func checkProcessDarwin() (bool, error) {
	return checkProcessLinuxLike("-f", "Contents/MacOS/Rancher Desktop")
}

func checkProcessLinux() (bool, error) {
	return checkProcessLinuxLike("rancher-desktop")
}

func checkProcessLinuxLike(commandPattern ...string) (bool, error) {
	result, err := exec.Command("pgrep", commandPattern...).CombinedOutput()
	if err != nil {
		return false, err
	}
	ptn := regexp.MustCompile(`\A[0-9\s]+\z`)
	return ptn.Match(result), nil
}

// RancherDesktopQemuCommand - be specific to avoid killing other VM-based processes running qemu
const RancherDesktopQemuCommand = "lima/bin/qemu-system.*rancher-desktop/lima/[0-9]/diffdisk"

func checkProcessQemu() (bool, error) {
	return checkProcessLinuxLike("-f", RancherDesktopQemuCommand)
}

func pkillQemu() error {
	cmd := exec.Command("pkill", "-9", "-f", RancherDesktopQemuCommand)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("Failed to kill qemu: %w", err)
	}
	return nil
}

func pkillDarwin() error {
	cmd := exec.Command("/usr/bin/pkill", "-9", "-a", "-l", "-f", "Contents/MacOS/Rancher Desktop")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("Failed to kill qemu: %w", err)
	}
	return nil
}

func pkillLinux() error {
	err := exec.Command("pkill", "-9", "rancher-desktop").Run()
	if err != nil {
		return fmt.Errorf("Failed to kill rancher-desktop: %w", err)
	}
	return nil
}
