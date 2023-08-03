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

func NewManager(paths paths.Paths) Manager {
	return Manager{
		Paths: paths,
	}
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
			return Snapshot{}, ErrNameExists
		}
	}
	if !nameRegexp.MatchString(name) {
		return Snapshot{}, ErrInvalidName
	}

	snapshot := Snapshot{
		Created: time.Now(),
		Name:    name,
		ID:      randomString(10),
	}

	// create the snapshot directory
	snapshotDir := filepath.Join(manager.Paths.Snapshots, snapshot.ID)
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return Snapshot{}, fmt.Errorf("failed to create snapshot directory: %w", err)
	}

	// do operations that can fail, rolling back if failure is encountered
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
	// copy settings.json
	snapshotDir := filepath.Join(manager.Paths.Snapshots, snapshot.ID)
	settingsPath := filepath.Join(manager.Paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(snapshotDir, "settings.json")
	if err := copyFile(snapshotSettingsPath, settingsPath, false); err != nil {
		return fmt.Errorf("failed to copy settings.json: %w", err)
	}

	// copy lima's override.yaml file
	overridePath := filepath.Join(manager.Paths.Lima, "_config", "override.yaml")
	snapshotOverridePath := filepath.Join(snapshotDir, "override.yaml")
	if err := copyFile(snapshotOverridePath, overridePath, false); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to copy override.yaml: %w", err)
	}

	// copy the VM image
	for _, image := range []string{"basedisk", "diffdisk"} {
		imagePath := filepath.Join(manager.Paths.Lima, "0", image)
		snapshotImagePath := filepath.Join(snapshotDir, image)
		if err := copyFile(snapshotImagePath, imagePath, true); err != nil {
			return fmt.Errorf("failed to clone %s: %w", image, err)
		}
	}

	// Create metadata.json file. This is done last because we consider
	// the presence of this file to be the hallmark of a complete and
	// valid snapshot.
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
	snapshotDir := filepath.Join(manager.Paths.Snapshots, id)
	metadataPath := filepath.Join(snapshotDir, "metadata.json")
	contents, err := os.ReadFile(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to read metadata for snapshot %q: %w", id, err)
	}
	snapshot := Snapshot{}
	if err := json.Unmarshal(contents, &snapshot); err != nil {
		return fmt.Errorf("failed to unmarshal contents of %q: %w", metadataPath, err)
	}

	// restore settings.json
	settingsPath := filepath.Join(manager.Paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(snapshotDir, "settings.json")
	if err := copyFile(settingsPath, snapshotSettingsPath, false); err != nil {
		return fmt.Errorf("failed to restore settings.json: %w", err)
	}

	// restore override.yaml
	overridePath := filepath.Join(manager.Paths.Lima, "_config", "override.yaml")
	snapshotOverridePath := filepath.Join(snapshotDir, "override.yaml")
	if err := copyFile(overridePath, snapshotOverridePath, false); errors.Is(err, os.ErrNotExist) {
		if err := os.RemoveAll(overridePath); err != nil {
			return fmt.Errorf("failed to remove override.yaml: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("failed to restore override.yaml: %w", err)
	}

	// restore VM image
	for _, image := range []string{"basedisk", "diffdisk"} {
		imagePath := filepath.Join(manager.Paths.Lima, "0", image)
		snapshotImagePath := filepath.Join(snapshotDir, image)
		if err := copyFile(imagePath, snapshotImagePath, true); err != nil {
			return fmt.Errorf("failed to restore %s: %w", image, err)
		}
	}
	return nil
}
