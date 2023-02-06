package autostart

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func EnsureAutostart(autostartDesired bool) error {
	autostartKey, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key: %w", err)
	}
	defer autostartKey.Close()

	if autostartDesired {
		rancherDesktopPath, err := getRancherDesktopPath()
		if err != nil {
			return fmt.Errorf("failed to get path to Rancher Desktop: %w", err)
		}
		err = autostartKey.SetStringValue("RancherDesktop", rancherDesktopPath)
		if err != nil {
			return fmt.Errorf("failed to set RancherDesktop value: %w", err)
		}
	} else {
		err = autostartKey.DeleteValue("RancherDesktop")
		if err != nil && !errors.Is(err, registry.ErrNotExist) {
			return fmt.Errorf("failed to remove RancherDesktop value: %w", err)
		}
	}

	return nil
}

// Gets the path to the installed Rancher Desktop executable.
// Only valid on Windows.
func getRancherDesktopPath() (string, error) {
	rdctlSymlinkPath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to get path to rdctl: %w", err)
	}

	rdctlPath, err := filepath.EvalSymlinks(rdctlSymlinkPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve possible symlink path %s: %w", rdctlSymlinkPath, err)
	}

	rdctlDirectory := filepath.Dir(rdctlPath)
	rancherDesktopPath, err := recurseBackwardsToFindFile(rdctlDirectory, "Rancher Desktop.exe")
	if err != nil {
		return "", fmt.Errorf("failed to get Rancher Desktop.exe path: %w", err)
	}
	return rancherDesktopPath, nil
}

// Given a directory and a filename to search for, searches the directory
// for a file of that name. If no file is found, it then looks in the parent
// directory of the original directory. This continues recursively until either a file
// is found, or the root directory is reached. Returns the full path
// to the found file.
func recurseBackwardsToFindFile(currentDirectory string, name string) (string, error) {
	// search dir for file of name `name`
	dirEntries, err := os.ReadDir(currentDirectory)
	if err != nil {
		return "", fmt.Errorf("failed to read directory %s: %w", currentDirectory, err)
	}
	for _, dirEntry := range dirEntries {
		if dirEntry.Name() == name {
			return filepath.Join(currentDirectory, name), nil
		}
	}

	// return error if current directory is root directory
	rootDirectory := filepath.VolumeName(currentDirectory) + string(filepath.Separator)
	if rootDirectory == currentDirectory {
		return "", fmt.Errorf("failed to find file %s", name)
	}

	parentDirectory := filepath.Dir(currentDirectory)
	return recurseBackwardsToFindFile(parentDirectory, name)
}
