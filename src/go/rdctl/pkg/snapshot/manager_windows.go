package snapshot

import (
	"errors"
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// Note: on Windows, there are syscalls such as CopyFile and CopyFileEx
// that may speed up the process of copying a file, but they appear to require
// loading DLL's. This approach works fine for copying smaller files, but if
// we need to copy big files it may be worth the complexity to use the syscall.
func copyFile(dst, src string) error {
	srcFd, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFd.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("failed to create destination parent dir: %w", err)
	}
	dstFd, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to open destination file: %w", err)
	}
	defer dstFd.Close()
	if _, err := io.Copy(dstFd, srcFd); err != nil {
		return fmt.Errorf("failed to copy contents of src to dst: %w", err)
	}
	return nil
}

func createFiles(paths paths.Paths, snapshot Snapshot) error {
	// ensure snapshot directory is created
	snapshotDir := filepath.Join(paths.Snapshots, snapshot.ID)
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return fmt.Errorf("failed to create snapshot directory %q: %w", snapshotDir, err)
	}

	// export WSL distros to snapshot directory
	for _, distroName := range []string{"rancher-desktop", "rancher-desktop-data"} {
		vhdxName := fmt.Sprintf("%s.vhdx", distroName)
		dstPath := filepath.Join(snapshotDir, vhdxName)
		cmd := exec.Command("wsl.exe", "--export", "--vhd", distroName, dstPath)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to export WSL distro %q: %w", distroName, err)
		}
	}

	// copy settings.json to snapshot directory
	workingSettingsPath := filepath.Join(paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(paths.Snapshots, snapshot.ID, "settings.json")
	if err := copyFile(snapshotSettingsPath, workingSettingsPath); err != nil {
		return fmt.Errorf("failed to copy %q to snapshot directory: %w", workingSettingsPath, err)
	}

	if err := writeMetadataFile(paths, snapshot); err != nil {
		return err
	}
	return nil
}

func restoreFiles(paths paths.Paths, snapshot Snapshot) error {
	return errors.New("not implemented")
}
