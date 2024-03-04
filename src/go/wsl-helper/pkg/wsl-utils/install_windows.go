package wslutils

import (
	"context"
	"errors"
	"os/exec"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

// InstallWSL runs wsl.exe to install WSL.
func InstallWSL(ctx context.Context, log *logrus.Entry) error {
	// wsl.exe calls wslapi.dll, which eventually uses the WinRT API
	// Windows.ApplicationModel.Store.Preview.InstallControl — but that is
	// (according to docs) private and only usable by Microsoft-signed apps.
	// Just spawn wsl.exe and hope it does the job.  Trying to reverse-engineer
	// the WslInstaller COM component seems error-prone, and it will likely
	// change in the future.  Unfortunately, this means more UAC prompts.
	newRunnerFunc := NewWSLRunner
	if f := ctx.Value(&kWSLExeOverride); f != nil {
		newRunnerFunc = f.(func() WSLRunner)
	}
	// WSL install hangs if we set stdout; don't set that here.
	err := newRunnerFunc().
		WithStderr(log.WriterLevel(logrus.InfoLevel)).
		Run(ctx, "--install", "--no-distribution")
	if err != nil {
		return err
	}
	return nil
}

// UpdateWSL runs wsl.exe to update the WSL kernel.  This assumes that WSL had
// already been installed.  This may request elevation.
func UpdateWSL(ctx context.Context, log *logrus.Entry) error {
	// Similar to InstallWSL, the best we have so far is just to spawn wsl.exe and
	// hope it does the right thing.  We can technically fetch the .msixbundle
	// from https://api.github.com/repos/Microsoft/WSL/releases/latest and install
	// it with PackageManager.AddPackageAsync but that isn't really useful.
	newRunnerFunc := NewWSLRunner
	if f := ctx.Value(&kWSLExeOverride); f != nil {
		newRunnerFunc = f.(func() WSLRunner)
	}
	// WSL install hangs if we set stdout; don't set that here.
	runner := newRunnerFunc().WithStderr(log.WriterLevel(logrus.InfoLevel))
	err := runner.Run(ctx, "--update")
	if err != nil {
		// Since we're running from Windows Installer, `wsl --update` will fail
		// because the Windows Installer database is locked (by us).  It will,
		// however, succeed the next time we use WSL.  It seems to return
		// STATUS_CONTROL_C_EXIT in this case, so catch that error code and
		// ignore it.  Unfortunately, this means we can't check that the update
		// has succeeded (because it hasn't, yet).
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			if exitError.ExitCode() == int(windows.STATUS_CONTROL_C_EXIT) {
				log.WithError(err).Trace("wsl --update exited with error as expected (ignoring)")
			} else {
				return err
			}
		} else {
			return err
		}
	}
	return nil
}
