package snapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"os"
	"path/filepath"
)

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
			WorkingPath:  filepath.Join(paths.Lima, "0", "diffdisk"),
			SnapshotPath: filepath.Join(snapshotDir, "diffdisk"),
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

// Does all of the things that can fail when creating a snapshot,
// so that the snapshot creation can easily be rolled back upon
// a failure.
func createFiles(paths paths.Paths, snapshot Snapshot) error {
	files := getSnapshotFiles(paths, snapshot.ID)
	for _, file := range files {
		err := copyFile(file.SnapshotPath, file.WorkingPath, file.CopyOnWrite, file.FileMode)
		if errors.Is(err, os.ErrNotExist) && file.MissingOk {
			continue
		} else if err != nil {
			return fmt.Errorf("failed to copy %s: %w", filepath.Base(file.WorkingPath), err)
		}
	}

	// Create metadata.json file. This is done last because we consider
	// the presence of this file to be the hallmark of a complete and
	// valid snapshot.
	metadataPath := filepath.Join(paths.Snapshots, snapshot.ID, "metadata.json")
	metadataFile, err := os.Create(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to create metadata file: %w", err)
	}
	defer metadataFile.Close()
	encoder := json.NewEncoder(metadataFile)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(snapshot); err != nil {
		return fmt.Errorf("failed to write metadata file: %w", err)
	}

	return nil
}

// Restores the files from their location in a snapshot directory
// to their working location.
func restoreFiles(files []snapshotFile) error {
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
