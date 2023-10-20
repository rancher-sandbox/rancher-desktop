package snapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

const completeFileName = "complete.txt"
const completeFileContents = "The presence of this file indicates that this snapshot is complete and valid."

var nameRegexp = *regexp.MustCompile("^[0-9a-zA-Z_-]{0,100}$")
var ErrNameExists = errors.New("name already exists")
var ErrInvalidName = fmt.Errorf("name does not match regex %q", nameRegexp.String())
var ErrIncompleteSnapshot = errors.New("snapshot is not complete")

func writeMetadataFile(appPaths paths.Paths, snapshot Snapshot) error {
	snapshotDir := filepath.Join(appPaths.Snapshots, snapshot.ID)
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return fmt.Errorf("failed to create snapshot directory: %w", err)
	}
	metadataPath := filepath.Join(snapshotDir, "metadata.json")
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

// Handles all snapshot-related functionality.
type Manager struct {
	Paths       paths.Paths
	Snapshotter Snapshotter
}

func NewManager(paths paths.Paths) Manager {
	return Manager{
		Paths:       paths,
		Snapshotter: NewSnapshotterImpl(paths),
	}
}

func (manager *Manager) GetSnapshotId(desiredName string) (string, error) {
	snapshots, err := manager.List(false)
	if err != nil {
		return "", fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, candidate := range snapshots {
		if desiredName == candidate.Name {
			return candidate.ID, nil
		}
	}
	return "", fmt.Errorf(`can't find snapshot %q`, desiredName)
}

// ValidateName - does syntactic validation on the name
func (manager Manager) ValidateName(name string) error {
	currentSnapshots, err := manager.List(false)
	if err != nil {
		return fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, currentSnapshot := range currentSnapshots {
		if currentSnapshot.Name == name {
			return fmt.Errorf("invalid name %q: %w", name, ErrNameExists)
		}
	}
	if !nameRegexp.MatchString(name) {
		return fmt.Errorf("invalid name %q: %w", name, ErrInvalidName)
	}
	return nil
}

// Creates a new snapshot.
func (manager Manager) Create(name, description string) (*Snapshot, error) {
	id, err := uuid.NewRandom()
	if err != nil {
		return nil, fmt.Errorf("failed to generate ID for snapshot: %w", err)
	}
	snapshot := Snapshot{
		Created:     time.Now(),
		Name:        name,
		ID:          id.String(),
		Description: description,
	}

	// do operations that can fail, rolling back if failure is encountered
	snapshotDir := filepath.Join(manager.Paths.Snapshots, snapshot.ID)
	if err := manager.Snapshotter.CreateFiles(snapshot); err != nil {
		if err := os.RemoveAll(snapshotDir); err != nil {
			return nil, fmt.Errorf("failed to delete created snapshot directory: %w", err)
		}
		return nil, fmt.Errorf("failed to consummate snapshot: %w", err)
	}

	return &snapshot, nil
}

// Returns snapshots that are present on the system. If includeIncomplete is
// true, includes snapshots that are currently being created, are currently
// being deleted, or are otherwise incomplete and cannot be restored from.
func (manager Manager) List(includeIncomplete bool) ([]Snapshot, error) {
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

		completeFilePath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, completeFileName)
		_, err = os.Stat(completeFilePath)
		completeFileExists := err == nil

		if !includeIncomplete && !completeFileExists {
			continue
		}

		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

// Deletes a snapshot.
func (manager Manager) Delete(id string) error {
	snapshotDir := filepath.Join(manager.Paths.Snapshots, id)
	// Remove complete.txt file. This must be done first because restoring
	// from a partially-deleted snapshot could result in errors.
	completeFilePath := filepath.Join(snapshotDir, completeFileName)
	if err := os.RemoveAll(completeFilePath); err != nil {
		return fmt.Errorf("failed to remove %q: %w", completeFileName, err)
	}
	if err := os.RemoveAll(snapshotDir); err != nil {
		return fmt.Errorf("failed to remove dir %q: %w", snapshotDir, err)
	}
	return nil
}

// Restores Rancher Desktop to the state saved in a snapshot.
func (manager Manager) Restore(id string) error {
	// Before doing anything, ensure that the snapshot is complete
	completeFilePath := filepath.Join(manager.Paths.Snapshots, id, completeFileName)
	if _, err := os.Stat(completeFilePath); err != nil {
		return fmt.Errorf("snapshot %q: %w", id, ErrIncompleteSnapshot)
	}

	// Get metadata about snapshot
	metadataPath := filepath.Join(manager.Paths.Snapshots, id, "metadata.json")
	contents, err := os.ReadFile(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to read metadata for snapshot %q: %w", id, err)
	}
	snapshot := Snapshot{}
	if err := json.Unmarshal(contents, &snapshot); err != nil {
		return fmt.Errorf("failed to unmarshal contents of %q: %w", metadataPath, err)
	}

	if err := manager.Snapshotter.RestoreFiles(snapshot); err != nil {
		return fmt.Errorf("failed to restore files: %w", err)
	}

	return nil
}
