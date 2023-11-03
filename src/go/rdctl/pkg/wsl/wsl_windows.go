package wsl

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"os/exec"
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
	return factoryreset.UnregisterWSL()
}

func (wsl WSLImpl) ExportDistro(distroName, fileName string) error {
	cmd := exec.Command("wsl.exe", "--export", distroName, fileName)
	if output, err := cmd.Output(); err != nil {
		return fmt.Errorf("failed to export WSL distro %q: %w", distroName, wrapWSLError(output, err))
	}
	return nil
}

func (wsl WSLImpl) ImportDistro(distroName, installLocation, fileName string) error {
	cmd := exec.Command("wsl.exe", "--import", distroName, installLocation, fileName, "--version", "2")
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
