package wsl

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
	"golang.org/x/text/encoding/unicode"
)

type WSL interface {
	// Deletes all WSL distros pertaining to Rancher Desktop.
	UnregisterDistros() error
	// Exports a distro as a .vhdx file and stores the result at
	// the path given in fileName.
	ExportDistro(distroName, fileName string) error
	// Imports a distro from a .vhdx file stored at path fileName
	// and names it distroName. Installs the distro in the directory
	// given by installLocation.
	ImportDistro(distroName, installLocation, fileName string) error
}

type WSLImpl struct{}

func (wsl WSLImpl) UnregisterDistros() error {
	cmd := exec.Command("wsl", "--list", "--quiet")
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	rawBytes, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error getting current WSLs: %w", err)
	}
	decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
	actualOutput, err := decoder.String(string(rawBytes))
	if err != nil {
		return fmt.Errorf("error getting current WSLs: %w", err)
	}
	actualOutput = strings.ReplaceAll(actualOutput, "\r", "")
	wsls := strings.Split(actualOutput, "\n")
	wslsToKill := []string{}
	for _, s := range wsls {
		if s == "rancher-desktop" || s == "rancher-desktop-data" {
			wslsToKill = append(wslsToKill, s)
		}
	}

	for _, wsl := range wslsToKill {
		cmd := exec.Command("wsl", "--unregister", wsl)
		cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
		if err := cmd.Run(); err != nil {
			logrus.Errorf("Error unregistering WSL distribution %s: %s\n", wsl, err)
		}
	}
	return nil
}

func (wsl WSLImpl) ExportDistro(distroName, fileName string) error {
	cmd := exec.Command("wsl.exe", "--export", distroName, fileName)
	// Prevents "signals" (think ctrl+C) from affecting called subprocess
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	if output, err := cmd.Output(); err != nil {
		return fmt.Errorf("failed to export WSL distro %q: %w", distroName, wrapWSLError(output, err))
	}
	return nil
}

func (wsl WSLImpl) ImportDistro(distroName, installLocation, fileName string) error {
	cmd := exec.Command("wsl.exe", "--import", distroName, installLocation, fileName, "--version", "2")
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
