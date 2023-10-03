package snapshot

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// Copies a file from src to dst. If copyOnWrite is true, attempts to
// use clonefile syscall to do the copy. If clonefile is not supported
// by the underlying filesystem, or src and dst are on different
// drives, falls back to a plain copy. If copyOnWrite is false, does a
// plain copy.
func copyFile(dst, src string, copyOnWrite bool, fileMode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("failed to create destination parent dir: %w", err)
	}
	if copyOnWrite {
		if err := unix.Clonefile(src, dst, 0); err == nil {
			return nil
		} else if !errors.Is(err, unix.ENOTSUP) && !errors.Is(err, unix.EXDEV) {
			return fmt.Errorf("failed to clone src to dest: %w", err)
		}
	}
	srcFd, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFd.Close()
	dstFd, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, fileMode)
	if err != nil {
		return fmt.Errorf("failed to open destination file: %w", err)
	}
	defer dstFd.Close()
	if _, err := io.Copy(dstFd, srcFd); err != nil {
		return fmt.Errorf("failed to copy contents of src to dst: %w", err)
	}
	return nil
}
