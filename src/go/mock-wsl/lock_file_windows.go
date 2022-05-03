package main

import (
	"fmt"
	"math"
	"os"

	"golang.org/x/sys/windows"
)

// lockFile locks the given file for exclusive access; if the file is already
// locked, this function will wait until it is unlocked.
func lockFile(f *os.File) error {
	err := windows.LockFileEx(
		windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK,
		0,
		math.MaxUint32, math.MaxUint32,
		nil)
	if err != nil {
		return fmt.Errorf("failed to lock file: %w", err)
	}
	return nil
}

/*
func unlockFile(f *os.File) error {
	err := windows.UnlockFileEx(
		f.Fd(),
		0,
		-1, -1,
		nil)
		if err != nil {
			return fmt.Errorf("failed to unlock file: %w", err)
		}
		return nil
	}
*/
