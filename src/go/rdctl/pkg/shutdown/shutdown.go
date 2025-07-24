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
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
)

type shutdownData struct {
	waitForShutdown bool
}

type InitiatingCommand string

const (
	Shutdown     InitiatingCommand = "shutdown"
	FactoryReset InitiatingCommand = "factory-reset"
	// When killing an application, the number of times to retry.
	appKillRetryCount = 15
	// When killing an application, time interval between retries.
	appKillWaitInterval = 2 * time.Second
)

var limaCtlPath string

func newShutdownData(waitForShutdown bool) *shutdownData {
	return &shutdownData{waitForShutdown: waitForShutdown}
}

// FinishShutdown - ensures that none of the Rancher Desktop related processes are around
// after a graceful shutdown command has been sent as part of either `rdctl shutdown` or
// `rdctl factory-reset`.
func FinishShutdown(ctx context.Context, waitForShutdown bool, initiatingCommand InitiatingCommand) error {
	s := newShutdownData(waitForShutdown)
	if runtime.GOOS == "windows" {
		return s.waitForAppToDieOrKillIt(ctx, factoryreset.CheckProcessWindows, factoryreset.KillRancherDesktop, false, "the app")
	}
	paths, err := p.GetPaths()
	if err != nil {
		logrus.Errorf("Ignoring error trying to get application paths: %s", err)
	} else if err = directories.SetupLimaHome(paths.AppHome); err != nil {
		logrus.Errorf("Ignoring error trying to get lima directory: %s", err)
	} else {
		limaCtlPath, err = directories.GetLimactlPath()
		if err != nil {
			logrus.Errorf("Ignoring error trying to get path to limactl: %s", err)
		} else {
			switch initiatingCommand {
			case Shutdown:
				err = s.waitForAppToDieOrKillIt(ctx, checkLima, stopLima, false, "lima")
				if err != nil {
					logrus.Errorf("Ignoring error trying to stop lima: %s", err)
				}
				// Check once more to see if lima is still running, and if so, run `limactl stop --force 0`
				err = s.waitForAppToDieOrKillIt(ctx, checkLima, stopLimaWithForce, true, "lima")
				if err != nil {
					logrus.Errorf("Ignoring error trying to force-stop lima: %s", err)
				}
			case FactoryReset:
				err = s.waitForAppToDieOrKillIt(ctx, checkLima, deleteLima, false, "lima")
				if err != nil {
					logrus.Errorf("Ignoring error trying to delete lima subtree: %s", err)
				}
			default:
				return fmt.Errorf("internal error: unknown shutdown initiating command of %q", initiatingCommand)
			}
		}
	}
	qemuExecutable, err := getQemuExecutable()
	if err != nil {
		return fmt.Errorf("failed to find qemu executable: %w", err)
	}
	err = s.waitForAppToDieOrKillIt(
		ctx,
		isExecutableRunningFunc(qemuExecutable),
		terminateExecutableFunc(qemuExecutable),
		false,
		"qemu")
	if err != nil {
		logrus.Errorf("Ignoring error trying to kill qemu: %s", err)
	}
	appDir, err := directories.GetApplicationDirectory(ctx)
	if err != nil {
		return fmt.Errorf("failed to find application directory: %w", err)
	}
	mainExecutablePath, err := p.GetMainExecutable(ctx)
	if err != nil {
		return fmt.Errorf("failed to get Rancher Desktop executable: %w", err)
	}
	return s.waitForAppToDieOrKillIt(
		ctx,
		isExecutableRunningFunc(mainExecutablePath),
		terminateRancherDesktopFunc(appDir),
		false,
		"the app")
}

// Run the given check function to detect if an application has exited, every
// appKillWaitInterval for appKillRetryCount times.  After all the checks have
// expired, run killFunc to terminate the application forcefully.  If skipRetry
// is true, do not wait at all and just kill immediately.
func (s *shutdownData) waitForAppToDieOrKillIt(ctx context.Context, checkFunc func(context.Context) (bool, error), killFunc func(context.Context) error, skipRetry bool, description string) error {
	for iter := 0; s.waitForShutdown && iter < appKillRetryCount; iter++ {
		if iter > 0 {
			logrus.Debugf("checking %s showed it's still running; sleeping for %s\n", description, appKillWaitInterval)
			time.Sleep(appKillWaitInterval)
		}
		status, err := checkFunc(ctx)
		if err != nil {
			return fmt.Errorf("while checking %s, found error: %w", description, err)
		}
		if !status {
			logrus.Debugf("%s is no longer running\n", description)
			return nil
		}
		if skipRetry {
			break
		}
	}
	logrus.Debugf("About to force-kill %s\n", description)
	return killFunc(ctx)
}

func getQemuExecutable() (string, error) {
	if runtime.GOOS == "windows" {
		return "", fmt.Errorf("qemu not installed on Windows")
	}
	resourcesDir, err := p.GetResourcesPath()
	if err != nil {
		return "", fmt.Errorf("failed to get resources directory: %w", err)
	}
	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "aarch64"
	default:
		arch = runtime.GOARCH
	}
	qemuName := fmt.Sprintf("qemu-system-%s", arch)
	candidates := []string{
		filepath.Join(resourcesDir, runtime.GOOS, "lima", "bin", qemuName),
	}
	if runtime.GOOS == "linux" {
		// On Linux, we may be running in AppImage; in that case, we need to check
		// the bundled qemu.
		candidates = append(
			candidates,
			filepath.Join(utils.GetParentDir(resourcesDir, 4), "usr", "bin", qemuName),
		)
	}
	return p.FindFirstExecutable(candidates...)
}

func isExecutableRunningFunc(executablePath string) func(context.Context) (bool, error) {
	return func(ctx context.Context) (bool, error) {
		pid, err := process.FindPidOfProcess(executablePath)
		if err != nil {
			return false, err
		}
		return pid != 0, nil
	}
}

func terminateExecutableFunc(executablePath string) func(context.Context) error {
	return func(ctx context.Context) error {
		pid, err := process.FindPidOfProcess(executablePath)
		if err != nil || pid == 0 {
			return err
		}
		proc, err := os.FindProcess(pid)
		if err != nil {
			return fmt.Errorf("failed to find process for pid %d: %w", pid, err)
		}
		// The pid might not exist even if we did not receive an error.
		err = proc.Signal(syscall.SIGTERM)
		if err != nil && !errors.Is(err, os.ErrProcessDone) {
			return fmt.Errorf("failed to terminate process %d: %w", pid, err)
		}
		return nil
	}
}

func checkLima(ctx context.Context) (bool, error) {
	cmd := exec.CommandContext(ctx, limaCtlPath, "ls", "--format", "{{.Status}}", "0")
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

func stopLima(ctx context.Context) error {
	return runCommandIgnoreOutput(exec.CommandContext(ctx, limaCtlPath, "stop", "0"))
}

func stopLimaWithForce(ctx context.Context) error {
	return runCommandIgnoreOutput(exec.CommandContext(ctx, limaCtlPath, "stop", "--force", "0"))
}

func deleteLima(ctx context.Context) error {
	return runCommandIgnoreOutput(exec.CommandContext(ctx, limaCtlPath, "delete", "--force", "0"))
}

func terminateRancherDesktopFunc(appDir string) func(context.Context) error {
	return func(ctx context.Context) error {
		var errs *multierror.Error

		errs = multierror.Append(errs, (func() error {
			mainExe, err := p.GetMainExecutable(ctx)
			if err != nil {
				return err
			}
			pid, err := process.FindPidOfProcess(mainExe)
			if err != nil {
				return err
			}
			return process.KillProcessGroup(pid, false)
		})())

		errs = multierror.Append(errs, process.TerminateProcessInDirectory(appDir, true))

		return errs.ErrorOrNil()
	}
}
