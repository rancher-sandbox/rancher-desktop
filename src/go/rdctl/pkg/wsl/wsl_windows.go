package wsl

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/lima"
)

type WSL interface {
	// Deletes all WSL distros pertaining to Rancher Desktop.
	UnregisterDistros(ctx context.Context) error
	// Exports a distro as a .vhdx file and stores the result at
	// the path given in fileName.
	ExportDistro(ctx context.Context, distroName, fileName string) error
	// Imports a distro from a .vhdx file stored at path fileName
	// and names it distroName. Installs the distro in the directory
	// given by installLocation.
	ImportDistro(ctx context.Context, distroName, installLocation, fileName string) error
}

type WSLImpl struct{}

func (wsl WSLImpl) UnregisterDistros(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "wsl", "--list", "--quiet")
	// Force WSL to output UTF-8 so it's easier to process. (os.Environ returns a
	// copy, so appending to it is safe.)
	cmd.Env = append(os.Environ(), "WSL_UTF8=1")
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	cmd.Stderr = os.Stderr
	rawBytes, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("error getting current WSL distributions: %w", err)
	}
	distrosToKill := []string{}
	for _, s := range strings.Fields(string(rawBytes)) {
		if slices.Contains([]string{DistributionName, DataDistributionName, lima.InstanceFullName}, s) {
			distrosToKill = append(distrosToKill, s)
		}
	}

	for _, distro := range distrosToKill {
		cmd := exec.CommandContext(ctx, "wsl", "--unregister", distro)
		cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			logrus.Errorf("Error unregistering WSL distribution %s: %s\n", distro, err)
		}
	}
	return nil
}

func (wsl WSLImpl) ExportDistro(ctx context.Context, distroName, fileName string) error {
	cmd := exec.CommandContext(ctx, "wsl.exe", "--export", distroName, fileName)
	// Prevents "signals" (think ctrl+C) from affecting called subprocess
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	if output, err := cmd.Output(); err != nil {
		return fmt.Errorf("failed to export WSL distro %q: %w", distroName, wrapWSLError(output, err))
	}
	return nil
}

func (wsl WSLImpl) ImportDistro(ctx context.Context, distroName, installLocation, fileName string) error {
	cmd := exec.CommandContext(ctx, "wsl.exe", "--import", distroName, installLocation, fileName, "--version", "2")
	// Prevents "signals" (think ctrl+C) from affecting called subprocess
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	if output, err := cmd.Output(); err != nil {
		return fmt.Errorf("failed to import WSL distro %q: %w", distroName, wrapWSLError(output, err))
	}
	return nil
}

// wrapWSLError is used to make errors returned from
// *exec.Cmd.Output() more helpful. It combines the string from the
// returned error, any data written to stdout, and any data written
// to stderr into the string of one error.
func wrapWSLError(output []byte, err error) error {
	if exitErr, ok := err.(*exec.ExitError); ok {
		return fmt.Errorf("%w stdout: %q stderr: %q", err, string(output), exitErr.Stderr)
	}
	return fmt.Errorf("%w: stdout: %q", err, string(output))
}
