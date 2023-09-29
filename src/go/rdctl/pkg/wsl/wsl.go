package wsl

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"os/exec"
)

type WSL interface {
	// Unregisters all WSL distros pertaining to Rancher Desktop.
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
	cmd := exec.Command("wsl.exe", "--export", "--vhd", distroName, fileName)
	if output, err := cmd.Output(); err != nil {
		return fmt.Errorf("failed to export WSL distro %q: %w", distroName, wrapWSLError(output, err))
	}
	return nil
}

func (wsl WSLImpl) ImportDistro(distroName, installLocation, fileName string) error {
	cmd := exec.Command("wsl.exe", "--import", distroName, installLocation, fileName, "--vhd")
	if output, err := cmd.Output(); err != nil {
		return fmt.Errorf("failed to import WSL distro %q: %w", distroName, wrapWSLError(output, err))
	}
	return nil
}

// When we run a wsl.exe *exec.Cmd, and the command fails, the
// returned error is not helpful. However, the text it outputs is
// helpful. wrapWSLError combines the two to provide more helpful
// error text.
func wrapWSLError(output []byte, err error) error {
	return fmt.Errorf("%w: %s", err, string(output))
}
