package utils

import (
	"io/fs"
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
)

// Get the parent (or grandparent, or great-grandparent...) directory of fullPath.
// numberTimes is the number of steps to ascend in the directory hierarchy.
func MoveToParent(fullPath string, numberTimes int) string {
	fullPath = filepath.Clean(fullPath)
	for ; numberTimes > 0; numberTimes-- {
		fullPath = filepath.Dir(fullPath)
	}
	return fullPath
}

/**
 * Verify the path exists. For Linux pass in mode bits to guarantee the file is executable (for at least one
 * category of user). Note that on macOS the candidate is a directory, so never pass in mode bits.
 * And mode bits don't make sense on Windows.
 */
func CheckExistence(candidatePath string, modeBits fs.FileMode) string {
	stat, err := os.Stat(candidatePath)
	if err != nil {
		return ""
	}
	if modeBits != 0 && (!stat.Mode().IsRegular() || stat.Mode().Perm()&modeBits == 0) {
		// The modeBits check is only for executability -- we only care if at least one of the three
		// `x` mode bits is on. So this check isn't used for a general permission-mode-bit check.
		return ""
	}
	return candidatePath
}

// Returns the absolute path to the Rancher Desktop executable.
// Returns an empty string if the executable was not found.
func GetWindowsRDPath(rdctlPath string) string {
	if rdctlPath != "" {
		normalParentPath := MoveToParent(rdctlPath, 5)
		candidatePath := CheckExistence(filepath.Join(normalParentPath, "Rancher Desktop.exe"), 0)
		if candidatePath != "" {
			return candidatePath
		}
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
