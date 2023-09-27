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
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to export WSL distro %q: %w", distroName, err)
	}
	return nil
}

func (wsl WSLImpl) ImportDistro(distroName, installLocation, fileName string) error {
	cmd := exec.Command("wsl.exe", "--import", distroName, installLocation, fileName, "--vhd")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to import WSL distro %q: %w", distroName, err)
	}
	return nil
}
