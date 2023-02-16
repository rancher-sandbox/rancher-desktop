package utils

import (
	"fmt"
	"os"
	"path/filepath"
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

	// we're at .../Applications/R D.app (could have a different name)/Contents/Resources/resources/darwin/bin
	// and want to move to the "R D.app" part
	RDAppParentPath := getParentDir(rdctlPath, 6)
	if CheckExistence(filepath.Join(RDAppParentPath, "Contents", "MacOS", "Rancher Desktop"), 0o111) != "" {
		return RDAppParentPath, nil
	}

	// This fallback is mostly for running `npm run dev` and using the installed app because there is no app
	// that rdctl would launch directly in dev mode.
	candidatePath := filepath.Join("/Applications", "Rancher Desktop.app")
	if len(CheckExistence(candidatePath, 0)) {
		return candidatePath
	}

	return "", errors.New("search locations exhausted")
}
