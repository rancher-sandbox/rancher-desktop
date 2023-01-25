package autostart

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const regPath = `C:\Windows\system32\reg.exe`

func EnsureAutostart(autostartDesired bool) error {
	if autostartDesired {
		rancherDesktopPath, err := getRancherDesktopPath()
		if err != nil {
			return fmt.Errorf("Failed to get Rancher Desktop path: %w", err)
		}
		cmd := exec.Command(regPath, "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/f", "/v", "RancherDesktop", "/d", rancherDesktopPath)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to configure registry entry for autostart: %w", err)
		}
	} else {
		cmd := exec.Command(regPath, "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/f", "/v", "RancherDesktop")
		if output, err := cmd.CombinedOutput(); err != nil {
			trimmedOutput := strings.TrimSpace(string(output))
			if trimmedOutput == "ERROR: The system was unable to find the specified registry key or value." {
				// the key is not present or was already deleted
				return nil
			}
			return fmt.Errorf("failed to remove registry entry for autostart: %w", err)
		}
	}
	return nil
}

// Gets the path to the installed Rancher Desktop executable.
// Only valid on Windows.
func getRancherDesktopPath() (string, error) {
	rdctlSymlinkPath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("Failed to get path to rdctl: %w", err)
	}

	rdctlPath, err := filepath.EvalSymlinks(rdctlSymlinkPath)
	if err != nil {
		return "", fmt.Errorf("Failed to resolve possible symlink path %s: %w", rdctlSymlinkPath, err)
	}

	rdctlDirectory := filepath.Dir(rdctlPath)
	rancherDesktopPath, err := recurseBackwardsToFindFile(rdctlDirectory, "Rancher Desktop.exe")
	if err != nil {
		return "", fmt.Errorf("Failed to get Rancher Desktop.exe path: %w", err)
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
		return "", fmt.Errorf("Failed to read directory %s: %w", currentDirectory, err)
	}
	for _, dirEntry := range dirEntries {
		if dirEntry.Name() == name {
			return filepath.Join(currentDirectory, name), nil
		}
	}

	// return error if current directory is root directory
	rootDirectory := filepath.VolumeName(currentDirectory) + string(filepath.Separator)
	if rootDirectory == currentDirectory {
		return "", fmt.Errorf("Failed to find file %s", name)
	}

	parentDirectory := filepath.Dir(currentDirectory)
	return recurseBackwardsToFindFile(parentDirectory, name)
}
