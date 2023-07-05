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
	"strings"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/sirupsen/logrus"
)

type shutdownData struct {
	waitForShutdown bool
}

type InitiatingCommand string

const (
	Shutdown     InitiatingCommand = "shutdown"
	FactoryReset InitiatingCommand = "factory-reset"
)

var limaCtlPath string

func newShutdownData(waitForShutdown bool) *shutdownData {
	return &shutdownData{waitForShutdown: waitForShutdown}
}

// FinishShutdown - ensures that none of the Rancher Desktop related processes are around
// after a graceful shutdown command has been sent as part of either `rdctl shutdown` or
// `rdctl factory-reset`.
func FinishShutdown(waitForShutdown bool, initiatingCommand InitiatingCommand) error {
	s := newShutdownData(waitForShutdown)
	if runtime.GOOS == "windows" {
		return s.waitForAppToDieOrKillIt(factoryreset.CheckProcessWindows, factoryreset.KillRancherDesktop, 15, 2, "the app")
	}
	var err error
	if err = directories.SetupLimaHome(); err != nil {
		logrus.Errorf("Ignoring error trying to get lima directory: %s", err)
	} else {
		limaCtlPath, err = directories.GetLimactlPath()
		if err != nil {
			logrus.Errorf("Ignoring error trying to get path to limactl: %s", err)
		} else {
			switch initiatingCommand {
			case Shutdown:
				err = s.waitForAppToDieOrKillIt(checkLima, stopLima, 15, 2, "lima")
				if err != nil {
					logrus.Errorf("Ignoring error trying to stop lima: %s", err)
				}
				// Check once more to see if lima is still running, and if so, run `limactl stop --force 0`
				err = s.waitForAppToDieOrKillIt(checkLima, stopLimaWithForce, 1, 0, "lima")
				if err != nil {
					logrus.Errorf("Ignoring error trying to force-stop lima: %s", err)
				}
			case FactoryReset:
				err = s.waitForAppToDieOrKillIt(checkLima, deleteLima, 15, 2, "lima")
				if err != nil {
					logrus.Errorf("Ignoring error trying to delete lima subtree: %s", err)
				}
			default:
				return fmt.Errorf("internal error: unknown shutdown initiating command of '%s'", initiatingCommand)
			}
		}
	}
	err = s.waitForAppToDieOrKillIt(checkProcessQemu, pkillQemu, 15, 2, "qemu")
	if err != nil {
		logrus.Errorf("Ignoring error trying to kill qemu: %s", err)
	}
	switch runtime.GOOS {
	case "darwin":
		return s.waitForAppToDieOrKillIt(checkProcessDarwin, pkillDarwin, 5, 1, "the app")
	case "linux":
		return s.waitForAppToDieOrKillIt(checkProcessLinux, pkillLinux, 5, 1, "the app")
	default:
		return fmt.Errorf("unhandled runtime: %s", runtime.GOOS)
	}
}

func (s *shutdownData) waitForAppToDieOrKillIt(checkFunc func() (bool, error), killFunc func() error, retryCount int, retryWait int, operation string) error {
	for iter := 0; s.waitForShutdown && iter < retryCount; iter++ {
		if iter > 0 {
			logrus.Debugf("checking %s showed it's still running; sleeping %d seconds\n", operation, retryWait)
			time.Sleep(time.Duration(retryWait) * time.Second)
		}
		status, err := checkFunc()
		if err != nil {
			return fmt.Errorf("while checking %s, found error: %w", operation, err)
		}
		if !status {
			logrus.Debugf("%s is no longer running\n", operation)
			return nil
		}
	}
	logrus.Debugf("About to force-kill %s\n", operation)
	return killFunc()
}

/**
 * checkProcessX function returns [true, nil] if it detects the app is still running, [false, X] otherwise
 * The Linux/macOS functions never return a non-nil error and that field can be ignored.
 * If the Windows function returns a non-nil error, we can't conclude whether the specified process is running
 */

func checkProcessDarwin() (bool, error) {
	return checkProcessLinuxLike("-f", "Contents/MacOS/Rancher Desktop"), nil
}

func checkProcessLinux() (bool, error) {
	return checkProcessLinuxLike("rancher-desktop"), nil
}

func checkProcessLinuxLike(commandPattern ...string) bool {
	result, err := exec.Command("pgrep", commandPattern...).CombinedOutput()
	if err != nil {
		return false
	}
	return regexp.MustCompile(`\A[0-9\s]+\z`).Match(result)
}

// RancherDesktopQemuCommand - be specific to avoid killing other VM-based processes running qemu
const RancherDesktopQemuCommand = "lima/bin/qemu-system.*rancher-desktop/lima/[0-9]/diffdisk"

func checkProcessQemu() (bool, error) {
	return checkProcessLinuxLike("-f", RancherDesktopQemuCommand), nil
}

func pkill(args ...string) error {
	pkillBinary := "pkill"
	if runtime.GOOS == "darwin" {
		pkillBinary = "/usr/bin/pkill"
	}
	cmd := exec.Command(pkillBinary, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			// don't throw an error if the process we are killing has already exited
			if exitCode := exitError.ExitCode(); exitCode == 0 || exitCode == 1 {
				return nil
			}
		}
		return fmt.Errorf("error running pkill: %w", err)
	}
	return nil
}

func pkillQemu() error {
	err := pkill("-9", "-f", RancherDesktopQemuCommand)
	if err != nil {
		return fmt.Errorf("failed to kill qemu: %w", err)
	}
	return nil
}

func checkLima() (bool, error) {
	cmd := exec.Command(limaCtlPath, "ls", "--format", "{{.Status}}", "0")
	cmd.Stderr = os.Stderr
	result, err := cmd.Output()
	if err != nil {
		return false, err
	}
	return strings.HasPrefix(string(result), "Running"), nil
}

func runCommandIgnoreOutput(cmd *exec.Cmd) error {
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func stopLima() error {
	return runCommandIgnoreOutput(exec.Command(limaCtlPath, "stop", "0"))
}

func stopLimaWithForce() error {
	return runCommandIgnoreOutput(exec.Command(limaCtlPath, "stop", "--force", "0"))
}

func deleteLima() error {
	return runCommandIgnoreOutput(exec.Command(limaCtlPath, "delete", "--force", "0"))
}

func pkillDarwin() error {
	err := pkill("-9", "-a", "-l", "-f", "Contents/MacOS/Rancher Desktop")
	if err != nil {
		return fmt.Errorf("failed to kill Rancher Desktop: %w", err)
	}
	return nil
}

func pkillLinux() error {
	err := pkill("-9", "rancher-desktop")
	if err != nil {
		return fmt.Errorf("failed to kill Rancher Desktop: %w", err)
	}
	return nil
}
