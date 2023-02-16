package utils

import (
	"fmt"
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
	normalParentPath := getParentDir(rdctlPath, 5)
	candidatePath := CheckExistence(filepath.Join(normalParentPath, "Rancher Desktop.exe"), 0)
	if candidatePath != "" {
		return candidatePath
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
	// Add these two paths if the above two fail to find where the program was installed
	dataPaths = append(
		dataPaths,
		filepath.Join(homedir, "AppData", "Local"),
		filepath.Join(homedir, "AppData", "Roaming"),
	)
	for _, dataDir := range dataPaths {
		candidatePath := CheckExistence(filepath.Join(dataDir, "Programs", "Rancher Desktop", "Rancher Desktop.exe"), 0)
		if candidatePath != "" {
			return candidatePath
		}
	}
	return ""
}
