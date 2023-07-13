package snapshot

import (
	"errors"
	"fmt"
	"io"
	"os"

	"golang.org/x/sys/unix"
)

// "Copies" a file from one place to another. Uses ioctl FICLONE if
// the underlying filesystem supports ioctl FICLONE. If not, does a
// plain copy.
func clone(dst, src string) error {
	srcFd, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFd.Close()
	dstFd, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to open destination file: %w", err)
	}
	defer dstFd.Close()
	err = unix.IoctlFileClone(int(dstFd.Fd()), int(srcFd.Fd()))
	if err != nil && !errors.Is(err, unix.ENOTSUP) {
		return fmt.Errorf("failed to ioctl_ficlone file: %w", err)
	}

	// fall back to a plain copy if filesystem does not support ioctl FICLONE
	if _, err := io.Copy(dstFd, srcFd); err != nil {
		return fmt.Errorf("failed to copy contents of src to dst: %w", err)
	}
	return nil
}
