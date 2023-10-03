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
// use ioctl FICLONE to do the copy. If ioctl FICLONE is not supported
// by the underlying filesystem, falls back to a plain copy. If
// copyOnWrite is false, does a plain copy. fileMode specifies the
// permissions that are applied to the destination file.
func copyFile(dst, src string, copyOnWrite bool, fileMode os.FileMode) error {
	srcFd, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFd.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("failed to create destination parent dir: %w", err)
	}
	dstFd, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, fileMode)
	if err != nil {
		return fmt.Errorf("failed to open destination file: %w", err)
	}
	defer dstFd.Close()
	if copyOnWrite {
		if err := unix.IoctlFileClone(int(dstFd.Fd()), int(srcFd.Fd())); err == nil {
			return nil
		} else if !errors.Is(err, unix.ENOTSUP) {
			return fmt.Errorf("failed to ioctl_ficlone file: %w", err)
		}
	}
	if _, err := io.Copy(dstFd, srcFd); err != nil {
		return fmt.Errorf("failed to copy contents of src to dst: %w", err)
	}
	return nil
}
