package utils

import (
	"path/filepath"
)

// Get the steps-th parent directory of fullPath.
func GetParentDir(fullPath string, steps int) string {
	fullPath = filepath.Clean(fullPath)
	for ; steps > 0; steps-- {
		fullPath = filepath.Dir(fullPath)
	}
	return fullPath
}
