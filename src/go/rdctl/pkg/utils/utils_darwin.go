package utils

import (
	"path/filepath"
)

// Returns the absolute path to the Rancher Desktop executable.
// Returns an empty string if the executable was not found.
func GetRDPath(rdctlPath string) string {
	if rdctlPath != "" {
		// we're at .../Applications/R D.app (could have a different name)/Contents/Resources/resources/darwin/bin
		// and want to move to the "R D.app" part
		RDAppParentPath := MoveToParent(rdctlPath, 6)
		if CheckExistence(filepath.Join(RDAppParentPath, "Contents", "MacOS", "Rancher Desktop"), 0o111) != "" {
			return RDAppParentPath
		}
	}
	// This fallback is mostly for running `npm run dev` and using the installed app because there is no app
	// that rdctl would launch directly in dev mode.
	return CheckExistence(filepath.Join("/Applications", "Rancher Desktop.app"), 0)
}
