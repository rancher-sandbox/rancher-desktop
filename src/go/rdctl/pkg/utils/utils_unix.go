//go:build linux || darwin

package utils

import (
	"errors"
	"fmt"
	"io/fs"
	"os"

	"golang.org/x/sys/unix"
)

// Verify that the candidatePath is usable as a Rancher Desktop "executable". This means:
//   - check that candidatePath exists
//   - if checkExecutability is true, check that candidatePath is a regular file,
//     and that it is executable
//
// Note that candidatePath may not always be a file; in macOS, it may be a
// .app directory.
func checkUsableApplication(candidatePath string, checkExecutability bool) (bool, error) {
	statResult, err := os.Stat(candidatePath)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to get info on %q: %w", candidatePath, err)
	}

	if !checkExecutability {
		return true, nil
	}

	if !statResult.Mode().IsRegular() {
		return false, nil
	}

	err = unix.Access(candidatePath, unix.X_OK)
	return err == nil, nil
}
