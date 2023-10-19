package wslutils

import (
	"context"

	"github.com/sirupsen/logrus"
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
	err := newRunnerFunc().
		WithStdout(log.WriterLevel(logrus.TraceLevel)).
		WithStderr(log.WriterLevel(logrus.InfoLevel)).
		Run(ctx, "--install", "--no-distribution")
	if err != nil {
		return err
	}
	return nil
}
