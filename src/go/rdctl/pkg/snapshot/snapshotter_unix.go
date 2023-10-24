//go:build unix

package snapshot

import (
	"errors"
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"os"
	"path/filepath"
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

func getSnapshotFiles(paths paths.Paths, id string) []snapshotFile {
	snapshotDir := filepath.Join(paths.Snapshots, id)
	files := []snapshotFile{
		{
			WorkingPath:  filepath.Join(paths.Config, "settings.json"),
			SnapshotPath: filepath.Join(snapshotDir, "settings.json"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(paths.Lima, "_config", "override.yaml"),
			SnapshotPath: filepath.Join(snapshotDir, "override.yaml"),
			CopyOnWrite:  false,
			MissingOk:    true,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(paths.Lima, "0", "basedisk"),
			SnapshotPath: filepath.Join(snapshotDir, "basedisk"),
			CopyOnWrite:  true,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(paths.Lima, "_config", "user"),
			SnapshotPath: filepath.Join(snapshotDir, "user"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o600,
		},
		{
			WorkingPath:  filepath.Join(paths.Lima, "_config", "user.pub"),
			SnapshotPath: filepath.Join(snapshotDir, "user.pub"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(paths.Lima, "0", "lima.yaml"),
			SnapshotPath: filepath.Join(snapshotDir, "lima.yaml"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
	}
	return files
}

type SnapshotterImpl struct {
	Paths paths.Paths
}

func NewSnapshotterImpl(p paths.Paths) Snapshotter {
	return SnapshotterImpl{
		Paths: p,
	}
}

func (snapshotter SnapshotterImpl) CreateFiles(snapshot Snapshot) error {
	// Create metadata.json file. This happens first because creation
	// of subsequent files may take a while, and we always need to
	// have access to snapshot metadata.
	if err := writeMetadataFile(snapshotter.Paths, snapshot); err != nil {
		return err
	}

	if err := snapshotter.createDiffdisk(snapshot); err != nil {
		return err
	}

	files := getSnapshotFiles(snapshotter.Paths, snapshot.ID)
	for _, file := range files {
		err := copyFile(file.SnapshotPath, file.WorkingPath, file.CopyOnWrite, file.FileMode)
		if errors.Is(err, os.ErrNotExist) && file.MissingOk {
			continue
		} else if err != nil {
			return fmt.Errorf("failed to copy %s: %w", filepath.Base(file.WorkingPath), err)
		}
	}

	// Create complete.txt file. This is done last because its presence
	// signifies a complete and valid snapshot.
	completeFilePath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, completeFileName)
	if err := os.WriteFile(completeFilePath, []byte(completeFileContents), 0o644); err != nil {
		return fmt.Errorf("failed to write %q: %w", completeFileName, err)
	}

	return nil
}

// createDiffdisk copies the working diffdisk or diffdisk.raw to the
// snapshot directory. If diffdisk.raw is present, diffdisk is not copied
// to the snapshot directory. The two should never be present at the same
// time.
func (snapshotter SnapshotterImpl) createDiffdisk(snapshot Snapshot) error {
	diffdiskRawWorkingPath := filepath.Join(snapshotter.Paths.Lima, "0", "diffdisk.raw")
	diffdiskRawSnapshotPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, "diffdisk.raw")
	err := copyFile(diffdiskRawSnapshotPath, diffdiskRawWorkingPath, true, 0o644)
	if err == nil {
		return nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to copy diffdisk.raw: %w", err)
	}

	diffdiskWorkingPath := filepath.Join(snapshotter.Paths.Lima, "0", "diffdisk")
	diffdiskSnapshotPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, "diffdisk")
	err = copyFile(diffdiskSnapshotPath, diffdiskWorkingPath, true, 0o644)
	if err != nil {
		return fmt.Errorf("failed to copy diffdisk: %w", err)
	}

	return nil
}

// Restores the files from their location in a snapshot directory
// to their working location.
func (snapshotter SnapshotterImpl) RestoreFiles(snapshot Snapshot) error {
	if err := snapshotter.restoreDiffdisk(snapshot); err != nil {
		return err
	}

	files := getSnapshotFiles(snapshotter.Paths, snapshot.ID)
	for _, file := range files {
		filename := filepath.Base(file.WorkingPath)
		err := copyFile(file.WorkingPath, file.SnapshotPath, file.CopyOnWrite, file.FileMode)
		if errors.Is(err, os.ErrNotExist) && file.MissingOk {
			if err := os.RemoveAll(file.WorkingPath); err != nil {
				return fmt.Errorf("failed to remove %s: %w", filename, err)
			}
		} else if err != nil {
			return fmt.Errorf("failed to restore %s: %w", filename, err)
		}
	}
	return nil
}

// restoreDiffdisk copies either diffdisk.raw or diffdisk from a snapshot
// to its working location. If diffdisk.raw is present in the snapshot directory,
// it does not attempt to restore diffdisk. Both should never be present in a
// single snapshot directory.
func (snapshotter SnapshotterImpl) restoreDiffdisk(snapshot Snapshot) error {
	diffdiskRawWorkingPath := filepath.Join(snapshotter.Paths.Lima, "0", "diffdisk.raw")
	diffdiskRawSnapshotPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, "diffdisk.raw")
	diffdiskWorkingPath := filepath.Join(snapshotter.Paths.Lima, "0", "diffdisk")
	diffdiskSnapshotPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, "diffdisk")

	for _, filePath := range []string{diffdiskWorkingPath, diffdiskRawWorkingPath} {
		if err := os.RemoveAll(filePath); err != nil {
			return fmt.Errorf("failed to remove %q: %w", filePath, err)
		}
	}

	err := copyFile(diffdiskRawWorkingPath, diffdiskRawSnapshotPath, true, 0o644)
	if err == nil {
		return nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to copy diffdisk.raw: %w", err)
	}

	err = copyFile(diffdiskWorkingPath, diffdiskSnapshotPath, true, 0o644)
	if err != nil {
		return fmt.Errorf("failed to copy diffdisk: %w", err)
	}

	return nil
}
