package snapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/lock"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
)

const completeFileName = "complete.txt"
const completeFileContents = "The presence of this file indicates that this snapshot is complete and valid."
const maxNameLength = 250
const nameDisplayCutoffSize = 30

// Manager handles all snapshot-related functionality.
type Manager struct {
	Snapshotter
	*paths.Paths
	lock.BackendLocker
}

func NewManager() (*Manager, error) {
	appPaths, err := paths.GetPaths()
	if err != nil {
		return nil, err
	}
	manager := &Manager{
		Paths:         appPaths,
		Snapshotter:   NewSnapshotterImpl(),
		BackendLocker: &lock.BackendLock{},
	}
	return manager, nil
}

// Snapshot returns a Snapshot object for an existing and complete snapshot with the given name.
// It will return an error if no snapshot is found, or if the snapshot is not complete.
func (manager *Manager) Snapshot(name string) (Snapshot, error) {
	snapshots, err := manager.List(false)
	if err != nil {
		return Snapshot{}, fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, candidate := range snapshots {
		if name == candidate.Name {
			return candidate, nil
		}
	}
	return Snapshot{}, fmt.Errorf(`can't find snapshot %q`, name)
}

func (manager *Manager) SnapshotDirectory(snapshot Snapshot) string {
	return filepath.Join(manager.Snapshots, snapshot.ID)
}

// ValidateName checks that name is a valid snapshot name and that
// it is not used by an existing snapshot.
func (manager *Manager) ValidateName(name string) error {
	if name == "" {
		return fmt.Errorf("snapshot name must not be the empty string")
	}
	runeName := []rune(name)
	if len(runeName) > maxNameLength {
		errMsgName := truncate(name, nameDisplayCutoffSize)
		return fmt.Errorf(`invalid name %q: max length is %d, %d were specified`, errMsgName, maxNameLength, len(runeName))
	}
	if err := checkForInvalidCharacter(name); err != nil {
		return err
	}
	if unicode.IsSpace(rune(name[0])) {
		errMsgName := truncate(name, nameDisplayCutoffSize)
		return fmt.Errorf(`invalid name %q: must not start with a white-space character`, errMsgName)
	}
	if unicode.IsSpace(runeName[len(runeName)-1]) {
		errMsgName := name
		if len(runeName) > nameDisplayCutoffSize {
			errMsgName = "…" + string(runeName[len(runeName)-nameDisplayCutoffSize:])
		}
		return fmt.Errorf(`invalid name %q: must not end with a white-space character`, errMsgName)
	}
	currentSnapshots, err := manager.List(false)
	if err != nil {
		return fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, currentSnapshot := range currentSnapshots {
		if currentSnapshot.Name == name {
			errMsgName := truncate(name, nameDisplayCutoffSize)
			return fmt.Errorf("name %q already exists", errMsgName)
		}
	}
	return nil
}

func (manager *Manager) writeMetadataFile(snapshot Snapshot) error {
	snapshotDir := manager.SnapshotDirectory(snapshot)
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

// Create a new snapshot.
func (manager *Manager) Create(ctx context.Context, name, description string) (Snapshot, error) {
	id, err := uuid.NewRandom()
	if err != nil {
		return Snapshot{}, fmt.Errorf("failed to generate ID for snapshot: %w", err)
	}
	snapshot := Snapshot{
		Created:     time.Now(),
		Name:        name,
		ID:          id.String(),
		Description: description,
	}
	action := fmt.Sprintf("Creating snapshot %q", name)
	if err := manager.Lock(ctx, manager.Paths, action); err != nil {
		return snapshot, err
	}
	defer func() {
		if err != nil {
			os.RemoveAll(manager.SnapshotDirectory(snapshot))
		}
		unlockErr := manager.Unlock(ctx, manager.Paths, true)
		if err == nil {
			err = unlockErr
		}
	}()
	// (Re)validate the name after acquiring the lock in case another process created a snapshot with the same name
	if err := manager.ValidateName(name); err != nil {
		return snapshot, err
	}
	if err = manager.writeMetadataFile(snapshot); err == nil {
		err = manager.CreateFiles(ctx, manager.Paths, manager.SnapshotDirectory(snapshot))
	}
	return snapshot, err
}

// List snapshots that are present on the system. If includeIncomplete is
// true, includes snapshots that are currently being created, are currently
// being deleted, or are otherwise incomplete and cannot be restored from.
func (manager *Manager) List(includeIncomplete bool) ([]Snapshot, error) {
	dirEntries, err := os.ReadDir(manager.Snapshots)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return []Snapshot{}, fmt.Errorf("failed to read snapshots directory: %w", err)
	}
	snapshots := make([]Snapshot, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		if _, err := uuid.Parse(dirEntry.Name()); err != nil {
			continue
		}
		snapshot := Snapshot{}
		metadataPath := filepath.Join(manager.Snapshots, dirEntry.Name(), "metadata.json")
		contents, err := os.ReadFile(metadataPath)
		if err != nil {
			return []Snapshot{}, fmt.Errorf("failed to read %q: %w", metadataPath, err)
		}
		if err := json.Unmarshal(contents, &snapshot); err != nil {
			return []Snapshot{}, fmt.Errorf("failed to unmarshal contents of %q: %w", metadataPath, err)
		}
		// TODO this should be done by the caller
		snapshot.Created = snapshot.Created.Local()

		completeFilePath := filepath.Join(manager.Snapshots, snapshot.ID, completeFileName)
		_, err = os.Stat(completeFilePath)
		completeFileExists := err == nil

		if !includeIncomplete && !completeFileExists {
			continue
		}

		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

// Delete a snapshot.
func (manager *Manager) Delete(name string) error {
	snapshot, err := manager.Snapshot(name)
	if err != nil {
		return err
	}
	snapshotDir := manager.SnapshotDirectory(snapshot)
	// Remove complete.txt file. This must be done first because restoring
	// from a partially-deleted snapshot could result in errors.
	err = os.RemoveAll(filepath.Join(snapshotDir, completeFileName))
	return errors.Join(err, os.RemoveAll(snapshotDir))
}

// Restore Rancher Desktop to the state saved in a snapshot.
func (manager *Manager) Restore(ctx context.Context, name string) (err error) {
	snapshot, err := manager.Snapshot(name)
	if err != nil {
		return err
	}

	action := fmt.Sprintf("Restoring snapshot %q", name)
	if err := manager.Lock(ctx, manager.Paths, action); err != nil {
		return err
	}
	defer func() {
		// Restart the backend only if a data reset occurred
		unlockErr := manager.Unlock(ctx, manager.Paths, !errors.Is(err, ErrDataReset))
		if err == nil {
			err = unlockErr
		}
	}()
	// If the context is marked done (i.e. the user cancelled the
	// operation) we can avoid running RestoreFiles() and thus avoid
	// an unnecessary data reset.
	if contextIsDone(ctx) {
		return runner.ErrContextDone
	}
	if err = manager.RestoreFiles(ctx, manager.Paths, manager.SnapshotDirectory(snapshot)); err != nil {
		return fmt.Errorf("failed to restore files: %w", err)
	}

	return nil
}

func checkForInvalidCharacter(name string) error {
	for idx, c := range name {
		if !unicode.IsPrint(c) {
			return fmt.Errorf("invalid character %q at position %d in name: all characters must be printable or a space", c, idx)
		}
	}
	return nil
}

func contextIsDone(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return true
	default:
		return false
	}
}

// Does a utf8-aware truncation of input to maximum maxChars
// unicode code points. Adds an ellipsis if truncation occurred.
func truncate(input string, maxChars int) string {
	runeInput := []rune(input)
	if len(runeInput) > maxChars {
		return string(runeInput[0:maxChars-1]) + "…"
	}
	return input
}
