//go:build unix

package snapshot

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
)

// Represents a file that is included in a snapshot.
type snapshotFile struct {
	// The path that Rancher Desktop uses.
	WorkingPath string
	// The path that the file is put at in a snapshot.
	SnapshotPath string
	// Whether clonefile (macOS) or ioctl_ficlone (Linux) should be used
	// when copying the file around.
	CopyOnWrite bool
	// Whether it is ok for the file to not be present.
	MissingOk bool
	// The permissions the file should have.
	FileMode os.FileMode
}

// SnapshotterImpl also works as a *Manager receiver
type SnapshotterImpl struct {
}

func NewSnapshotterImpl() Snapshotter {
	return SnapshotterImpl{}
}

func (snapshotter SnapshotterImpl) Files(appPaths *paths.Paths, snapshotDir string) []snapshotFile {
	files := []snapshotFile{
		{
			WorkingPath:  filepath.Join(appPaths.Config, "settings.json"),
			SnapshotPath: filepath.Join(snapshotDir, "settings.json"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(appPaths.Lima, "_config", "override.yaml"),
			SnapshotPath: filepath.Join(snapshotDir, "override.yaml"),
			CopyOnWrite:  false,
			MissingOk:    true,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(appPaths.Lima, "0", "basedisk"),
			SnapshotPath: filepath.Join(snapshotDir, "basedisk"),
			CopyOnWrite:  true,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(appPaths.Lima, "0", "diffdisk"),
			SnapshotPath: filepath.Join(snapshotDir, "diffdisk"),
			CopyOnWrite:  true,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(appPaths.Lima, "_config", "user"),
			SnapshotPath: filepath.Join(snapshotDir, "user"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o600,
		},
		{
			WorkingPath:  filepath.Join(appPaths.Lima, "_config", "user.pub"),
			SnapshotPath: filepath.Join(snapshotDir, "user.pub"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(appPaths.Lima, "0", "lima.yaml"),
			SnapshotPath: filepath.Join(snapshotDir, "lima.yaml"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
	}
	return files
}

func (snapshotter SnapshotterImpl) CreateFiles(ctx context.Context, appPaths *paths.Paths, snapshotDir string) error {
	taskRunner := runner.NewTaskRunner(ctx)
	files := snapshotter.Files(appPaths, snapshotDir)
	for _, file := range files {
		taskRunner.Add(func() error {
			err := copyFile(file.SnapshotPath, file.WorkingPath, file.CopyOnWrite, file.FileMode)
			if errors.Is(err, os.ErrNotExist) && file.MissingOk {
				return nil
			} else if err != nil {
				return fmt.Errorf("failed to copy %s: %w", filepath.Base(file.WorkingPath), err)
			}
			return nil
		})
	}

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

// Restores the files from their location in a snapshot directory
// to their working location.
func (snapshotter SnapshotterImpl) RestoreFiles(ctx context.Context, appPaths *paths.Paths, snapshotDir string) error {
	taskRunner := runner.NewTaskRunner(ctx)
	files := snapshotter.Files(appPaths, snapshotDir)
	for _, file := range files {
		taskRunner.Add(func() error {
			filename := filepath.Base(file.WorkingPath)
			err := copyFile(file.WorkingPath, file.SnapshotPath, file.CopyOnWrite, file.FileMode)
			if errors.Is(err, os.ErrNotExist) && file.MissingOk {
				if err := os.RemoveAll(file.WorkingPath); err != nil {
					return fmt.Errorf("failed to remove %q: %w", filename, err)
				}
			} else if err != nil {
				return fmt.Errorf("failed to restore %q: %w", filename, err)
			}
			return nil
		})
	}
	if err := taskRunner.Wait(); err != nil {
		for _, file := range files {
			_ = os.Remove(file.WorkingPath)
		}
		_ = os.RemoveAll(appPaths.Lima)
		return fmt.Errorf("%w: %w", ErrDataReset, err)
	}
	return nil
}
