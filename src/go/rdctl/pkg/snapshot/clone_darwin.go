package snapshot

import (
	"errors"
	"fmt"

	"golang.org/x/sys/unix"
)

// "Copies" a file from one place to another. Uses clonefile syscall if
// possible. If not, does a plain copy.
func clone(dst, src string) error {
	err := unix.Clonefile(src, dst, 0)
	if err == nil {
		return nil
	} else if !errors.Is(err, unix.ENOTSUP) && !errors.Is(err, unix.EXDEV) {
		return err
	}

	// fall back to plain copy
	if err := copyFile(dst, src, false); err != nil {
		return fmt.Errorf("failed to copy %q to %q: %w", src, dst, err)
	}
	return nil
}
