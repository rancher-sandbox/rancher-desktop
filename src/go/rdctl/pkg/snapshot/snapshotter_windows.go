package snapshot

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/wsl"
)

type wslDistro struct {
	// The name of the WSL distro.
	Name string
	// The path to the directory that is used to store the
	// copy of the distro that is actually used by WSL.
	WorkingDirPath string
}

// SnapshotterImpl also works as a *Manager receiver
type SnapshotterImpl struct {
	wsl.WSL
}

func (snapshotter SnapshotterImpl) WSLDistros(appPaths *paths.Paths) []wslDistro {
	return []wslDistro{
		{
			Name:           "rancher-desktop",
			WorkingDirPath: appPaths.WslDistro,
		},
		{
			Name:           "rancher-desktop-data",
			WorkingDirPath: appPaths.WslDistroData,
		},
	}
}

// Note: on Windows, there are system calls such as CopyFile and CopyFileEx
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

func NewSnapshotterImpl() SnapshotterImpl {
	return SnapshotterImpl{
		WSL: wsl.WSLImpl{},
	}
}

func (snapshotter SnapshotterImpl) CreateFiles(ctx context.Context, appPaths *paths.Paths, snapshotDir string) error {
	taskRunner := runner.NewTaskRunner(ctx)

	// export WSL distros to snapshot directory
	for _, distro := range snapshotter.WSLDistros(appPaths) {
		taskRunner.Add(func() error {
			snapshotDistroPath := filepath.Join(snapshotDir, distro.Name+".tar")
			if err := snapshotter.ExportDistro(ctx, distro.Name, snapshotDistroPath); err != nil {
				return fmt.Errorf("failed to export WSL distro %q: %w", distro.Name, err)
			}
			return nil
		})
	}

	// copy settings.json to snapshot directory
	taskRunner.Add(func() error {
		workingSettingsPath := filepath.Join(appPaths.Config, "settings.json")
		snapshotSettingsPath := filepath.Join(snapshotDir, "settings.json")
		if err := copyFile(snapshotSettingsPath, workingSettingsPath); err != nil {
			return fmt.Errorf("failed to copy %q to snapshot directory: %w", workingSettingsPath, err)
		}
		return nil
	})

	// Create complete.txt file. This is done last because its presence
	// signifies a complete and valid snapshot.
	taskRunner.Add(func() error {
		completeFilePath := filepath.Join(snapshotDir, completeFileName)
		if err := os.WriteFile(completeFilePath, []byte(completeFileContents), 0o644); err != nil {
			return fmt.Errorf("failed to write %q: %w", completeFileName, err)
		}
		return nil
	})

	return taskRunner.Wait()
}

func (snapshotter SnapshotterImpl) RestoreFiles(ctx context.Context, appPaths *paths.Paths, snapshotDir string) error {
	tr := runner.NewTaskRunner(ctx)

	// unregister WSL distros
	tr.Add(func() error {
		if err := snapshotter.UnregisterDistros(ctx); err != nil {
			return fmt.Errorf("failed to unregister WSL distros: %w", err)
		}
		return nil
	})

	// restore WSL distros
	for _, distro := range snapshotter.WSLDistros(appPaths) {
		tr.Add(func() error {
			snapshotDistroPath := filepath.Join(snapshotDir, distro.Name+".tar")
			if err := os.MkdirAll(distro.WorkingDirPath, 0o755); err != nil {
				return fmt.Errorf("failed to create install directory for distro %q: %w", distro.Name, err)
			}
			if err := snapshotter.ImportDistro(ctx, distro.Name, distro.WorkingDirPath, snapshotDistroPath); err != nil {
				return fmt.Errorf("failed to import WSL distro %q: %w", distro.Name, err)
			}
			return nil
		})
	}

	// copy settings.json back to its working location
	workingSettingsPath := filepath.Join(appPaths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(snapshotDir, "settings.json")
	tr.Add(func() error {
		if err := copyFile(workingSettingsPath, snapshotSettingsPath); err != nil {
			return fmt.Errorf("failed to restore %q: %w", workingSettingsPath, err)
		}
		return nil
	})
	if err := tr.Wait(); err != nil {
		_ = os.Remove(workingSettingsPath)
		_ = snapshotter.UnregisterDistros(ctx)
		return fmt.Errorf("%w: %w", ErrDataReset, err)
	}
	return nil
}
