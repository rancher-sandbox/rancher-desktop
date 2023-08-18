package snapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

var nameRegexp = *regexp.MustCompile("^[0-9a-zA-Z_-]{0,100}$")
var ErrNameExists = errors.New("name already exists")
var ErrInvalidName = fmt.Errorf("name does not match regex %q", nameRegexp.String())

// Handles all snapshot-related functionality.
type Manager struct {
	Paths paths.Paths
}

// Represents a file that is included in a snapshot.
type snapshotFile struct {
	// The path that Rancher Desktop uses.
	WorkingPath string
	// The path that the file is backed up to before attempting
	// a Restore.
	BackupPath string
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

func NewManager(paths paths.Paths) Manager {
	return Manager{
		Paths: paths,
	}
}

func (manager Manager) getSnapshotFiles(id string) []snapshotFile {
	snapshotDir := filepath.Join(manager.Paths.Snapshots, id)
	files := []snapshotFile{
		{
			WorkingPath:  filepath.Join(manager.Paths.Config, "settings.json"),
			SnapshotPath: filepath.Join(snapshotDir, "settings.json"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(manager.Paths.Lima, "_config", "override.yaml"),
			SnapshotPath: filepath.Join(snapshotDir, "override.yaml"),
			CopyOnWrite:  false,
			MissingOk:    true,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(manager.Paths.Lima, "0", "basedisk"),
			SnapshotPath: filepath.Join(snapshotDir, "basedisk"),
			CopyOnWrite:  true,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(manager.Paths.Lima, "0", "diffdisk"),
			SnapshotPath: filepath.Join(snapshotDir, "diffdisk"),
			CopyOnWrite:  true,
			MissingOk:    false,
			FileMode:     0o644,
		},
		{
			WorkingPath:  filepath.Join(manager.Paths.Lima, "_config", "user"),
			SnapshotPath: filepath.Join(snapshotDir, "user"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o600,
		},
		{
			WorkingPath:  filepath.Join(manager.Paths.Lima, "_config", "user.pub"),
			SnapshotPath: filepath.Join(snapshotDir, "user.pub"),
			CopyOnWrite:  false,
			MissingOk:    false,
			FileMode:     0o644,
		},
	}
	for i := range files {
		files[i].BackupPath = fmt.Sprintf("%s.backup", files[i].WorkingPath)
	}
	return files
}

// Creates a new snapshot.
func (manager Manager) Create(name string) (Snapshot, error) {
	// validate name
	currentSnapshots, err := manager.List()
	if err != nil {
		return Snapshot{}, fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, currentSnapshot := range currentSnapshots {
		if currentSnapshot.Name == name {
			return Snapshot{}, fmt.Errorf("invalid name %q: %w", name, ErrNameExists)
		}
	}
	if !nameRegexp.MatchString(name) {
		return Snapshot{}, fmt.Errorf("invalid name %q: %w", name, ErrInvalidName)
	}

	snapshot := Snapshot{
		Created: time.Now(),
		Name:    name,
		ID:      randomString(10),
	}

	// do operations that can fail, rolling back if failure is encountered
	snapshotDir := filepath.Join(manager.Paths.Snapshots, snapshot.ID)
	if err := manager.createFiles(snapshot); err != nil {
		if err := os.RemoveAll(snapshotDir); err != nil {
			return Snapshot{}, fmt.Errorf("failed to delete created snapshot directory: %w", err)
		}
		return Snapshot{}, fmt.Errorf("failed to consummate snapshot: %w", err)
	}

	return snapshot, nil
}

// Does all of the things that can fail when creating a snapshot,
// so that the snapshot creation can easily be rolled back upon
// a failure.
func (manager Manager) createFiles(snapshot Snapshot) error {
	files := manager.getSnapshotFiles(snapshot.ID)
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
	metadataPath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, "metadata.json")
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

// Returns snapshots that are present on system.
func (manager Manager) List() ([]Snapshot, error) {
	dirEntries, err := os.ReadDir(manager.Paths.Snapshots)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return []Snapshot{}, fmt.Errorf("failed to read snapshots directory: %w", err)
	}
	snapshots := make([]Snapshot, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		snapshot := Snapshot{}
		metadataPath := filepath.Join(manager.Paths.Snapshots, dirEntry.Name(), "metadata.json")
		contents, err := os.ReadFile(metadataPath)
		if err != nil {
			return []Snapshot{}, fmt.Errorf("failed to read %q: %w", metadataPath, err)
		}
		if err := json.Unmarshal(contents, &snapshot); err != nil {
			return []Snapshot{}, fmt.Errorf("failed to unmarshal contents of %q: %w", metadataPath, err)
		}
		snapshot.Created = snapshot.Created.Local()
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

// Deletes a snapshot.
func (manager Manager) Delete(id string) error {
	dirEntries, err := os.ReadDir(manager.Paths.Snapshots)
	if err != nil {
		return fmt.Errorf("failed to read snapshots dir: %w", err)
	}
	found := false
	for _, dirEntry := range dirEntries {
		if dirEntry.Name() == id {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("snapshot with id %q does not exist", id)
	}
	snapshotDir := filepath.Join(manager.Paths.Snapshots, id)
	if err = os.RemoveAll(snapshotDir); err != nil {
		return fmt.Errorf("failed to remove dir %q: %w", snapshotDir, err)
	}
	return nil
}

// Restores Rancher Desktop to the state saved in a snapshot.
func (manager Manager) Restore(id string) error {
	metadataPath := filepath.Join(manager.Paths.Snapshots, id, "metadata.json")
	contents, err := os.ReadFile(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to read metadata for snapshot %q: %w", id, err)
	}
	snapshot := Snapshot{}
	if err := json.Unmarshal(contents, &snapshot); err != nil {
		return fmt.Errorf("failed to unmarshal contents of %q: %w", metadataPath, err)
	}

	files := manager.getSnapshotFiles(snapshot.ID)
	if err := manager.createBackups(files); err != nil {
		manager.rollBackRestore(files)
		return fmt.Errorf("failed to create backups: %w", err)
	}
	if err := manager.restoreFiles(files); err != nil {
		manager.rollBackRestore(files)
		return fmt.Errorf("failed to restore files: %w", err)
	}
	if err := manager.removeBackups(files); err != nil {
		return fmt.Errorf("failed to remove backups: %w", err)
	}

	return nil
}

// Creates backups of working files so that they can be restored
// if the Restore fails.
func (manager Manager) createBackups(files []snapshotFile) error {
	for _, file := range files {
		err := os.Rename(file.WorkingPath, file.BackupPath)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("failed to back up %s: %w", filepath.Base(file.WorkingPath), err)
		}
	}
	return nil
}

// Called when something goes wrong in the process of restoring a snapshot.
// Does not do any error checking; just tries to put the working files
// back in the state they were before Restore was called.
func (manager Manager) rollBackRestore(files []snapshotFile) {
	for _, file := range files {
		os.Rename(file.BackupPath, file.WorkingPath)
	}
}

// Restores the files from their location in a snapshot directory
// to their working location.
func (manager Manager) restoreFiles(files []snapshotFile) error {
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

// Removes backups made during a Restore.
func (manager Manager) removeBackups(files []snapshotFile) error {
	for _, file := range files {
		if err := os.RemoveAll(file.BackupPath); err != nil {
			return fmt.Errorf("failed to remove %s: %w", filepath.Base(file.BackupPath), err)
		}
	}
	return nil
}
