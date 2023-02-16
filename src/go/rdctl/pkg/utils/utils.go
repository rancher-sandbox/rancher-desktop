package utils

import (
	"io/fs"
	"os"
	"path/filepath"
)

// Get the parent (or grandparent, or great-grandparent...) directory of fullPath.
// numberTimes is the number of steps to ascend in the directory hierarchy.
func getParentDir(fullPath string, numberTimes int) string {
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
