package utils

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
)

// Returns the absolute path to the Rancher Desktop executable.
// Returns an empty string if the executable was not found.
func GetRDPath() (string, error) {
	rdctlSymlinkPath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to get path to rdctl: %w", err)
	}
	rdctlPath, err := filepath.EvalSymlinks(rdctlSymlinkPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve %q: %w", rdctlSymlinkPath, err)
	}
	// rdctl should be at <installDir>/resources/resources/win32/bin/rdctl.exe.
	// rancher-desktop should be 5 directories up from that, at <installDir>/Rancher Desktop.exe.
	normalParentPath := getParentDir(rdctlPath, 5)
	candidatePath := filepath.Join(normalParentPath, "Rancher Desktop.exe")
	_, err = os.Stat(candidatePath)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("failed to check existence of %q: %w", candidatePath, err)
	}
	if err == nil {
		return candidatePath, nil
	}

	homedir, err := os.UserHomeDir()
	if err != nil {
		homedir = ""
	}
	dataPaths := []string{}
	// %LOCALAPPDATA%
	dir, err := directories.GetLocalAppDataDirectory()
	if err == nil {
		dataPaths = append(dataPaths, dir)
	}
	// %APPDATA%
	dir, err = directories.GetRoamingAppDataDirectory()
	if err == nil {
		dataPaths = append(dataPaths, dir)
	}
	dataPaths = append(
		dataPaths,
		filepath.Join(homedir, "AppData", "Local"),
		filepath.Join(homedir, "AppData", "Roaming"),
	)
	for _, dataDir := range dataPaths {
		candidatePath := filepath.Join(dataDir, "Programs", "Rancher Desktop", "Rancher Desktop.exe")
		_, err := os.Stat(candidatePath)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("failed to check existence of %q: %w", candidatePath, err)
		}
		if err == nil {
			return candidatePath, nil
		}
	}

	return "", errors.New("search locations exhausted")
}
