package utils

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Returns the absolute path to the Rancher Desktop executable,
// or an error if it was unable to find Rancher Desktop.
func GetRDPath() (string, error) {
	rdctlSymlinkPath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to get path to rdctl: %w", err)
	}
	rdctlPath, err := filepath.EvalSymlinks(rdctlSymlinkPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve %q: %w", rdctlSymlinkPath, err)
	}
	// rdctl should be at <installDir>/resources/resources/linux/bin/rdctl.
	// rancher-desktop should be 5 directories up from that, at <installDir>/rancher-desktop.
	normalParentPath := getParentDir(rdctlPath, 5)
	candidatePaths := []string{
		filepath.Join(normalParentPath, "rancher-desktop"),
		"/opt/rancher-desktop/rancher-desktop",
	}
	for _, candidatePath := range candidatePaths {
		usable, err := checkUsableApplication(candidatePath, true)
		if err != nil {
			return "", fmt.Errorf("failed to check usability of %q: %w", candidatePath, err)
		}
		if usable {
			return candidatePath, nil
		}
	}
	return "", errors.New("search locations exhausted")
}
