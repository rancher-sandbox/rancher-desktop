package utils

import (
	"os"
	"path/filepath"
)

// Returns the absolute path to the Rancher Desktop executable.
// Returns an empty string if the executable was not found.
func GetRDPath() string {
	rdctlPath, err := os.Executable()
	if err == nil {
		normalParentPath := getParentDir(rdctlPath, 5)
		candidatePath := CheckExistence(filepath.Join(normalParentPath, "rancher-desktop"), 0o111)
		if candidatePath != "" {
			return candidatePath
		}
	}
	return CheckExistence("/opt/rancher-desktop/rancher-desktop", 0o111)
}
