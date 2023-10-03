package snapshot

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type TestFile struct {
	Path     string
	Contents string
}

func TestManager(t *testing.T) {

	t.Run("Create should disallow two snapshots with the same name, even when the first is incomplete", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshotName := "test-snapshot"
		if err := manager.ValidateName(snapshotName); err != nil {
			t.Fatalf("failed to validate first snapshot: %s", err)
		}
		snapshot, err := manager.Create(snapshotName, "")
		if err != nil {
			t.Fatalf("failed to create first snapshot: %s", err)
		}
		completeFilePath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, completeFileName)
		if err := os.Remove(completeFilePath); err != nil {
			t.Fatalf("failed to remove %q from first snapshot: %s", completeFileName, err)
		}
		if err := manager.ValidateName(snapshotName); err == nil {
			t.Fatalf("failed to return error upon second snapshot with name %q", snapshotName)
		}
	})

	t.Run("Create should disallow invalid names", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		invalidNames := []string{
			"test!",
			`"test"`,
			`'test'`,
			"testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttest" +
				"testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttest",
		}
		for _, c := range strings.Split("!$^&*()[]{};:?/'` \\\"", "") {
			invalidNames = append(invalidNames, fmt.Sprintf("invalid%sname", c)) // spellcheck-ignore-line
		}
		for _, invalidName := range invalidNames {
			if err := manager.ValidateName(invalidName); err == nil {
				t.Errorf("name %q is invalid but no error was returned", invalidName)
			}
		}
	})

	for _, includeIncomplete := range []bool{true, false} {
		t.Run(fmt.Sprintf("List with includeIncomplete %t", includeIncomplete), func(t *testing.T) {
			paths, _ := populateFiles(t, true)
			manager := newTestManager(paths)
			lastSnapshot := &Snapshot{}
			for i := range []int{1, 2, 3} {
				snapshotName := fmt.Sprintf("test-snapshot-%d", i)
				snapshot, err := manager.Create(snapshotName, "")
				if err != nil {
					t.Fatalf("failed to create snapshot %q: %s", snapshotName, err)
				}
				lastSnapshot = snapshot
			}
			lastSnapshotCompleteFilePath := filepath.Join(manager.Paths.Snapshots, lastSnapshot.ID, completeFileName)
			if err := os.Remove(lastSnapshotCompleteFilePath); err != nil {
				t.Fatalf("failed to delete %q from snapshot %q: %s", completeFileName, lastSnapshot.ID, err)
			}
			snapshots, err := manager.List(includeIncomplete)
			if err != nil {
				t.Fatalf("failed to list snapshots: %s", err)
			}

			expectedLength := 0
			if includeIncomplete {
				expectedLength = 3
			} else {
				expectedLength = 2
			}
			if len(snapshots) != expectedLength {
				t.Errorf("unexpected length of snapshots slice %d (expected %d)", len(snapshots), expectedLength)
			}
		})
	}

	t.Run("Delete", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshot, err := manager.Create("test-snapshot", "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		snapshots, err := manager.List(false)
		if err != nil {
			t.Fatalf("failed to list snapshots before delete: %s", err)
		}
		if len(snapshots) != 1 {
			t.Fatalf("unexpected length of snapshots slice before delete %d", len(snapshots))
		}
		if err := manager.Delete(snapshot.ID); err != nil {
			t.Fatalf("failed to delete snapshot: %s", err)
		}
		snapshots, err = manager.List(false)
		if err != nil {
			t.Fatalf("failed to list snapshots after delete: %s", err)
		}
		if len(snapshots) != 0 {
			t.Fatalf("unexpected length of snapshots slice after delete %d", len(snapshots))
		}
	})

	t.Run("Operations on nonexistent snapshots return errors", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		err := manager.Delete("no-such-snapshot-id")
		if err == nil {
			t.Errorf("Failed to complain when asked to delete a nonexistent snapshot")
		}
		err = manager.Restore("no-such-snapshot-id")
		if err == nil {
			t.Errorf("Failed to complain when asked to restore a nonexistent snapshot")
		}
	})

	t.Run("Restore should return the proper error if asked to restore from an incomplete snapshot", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshot, err := manager.Create("test-snapshot", "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		completeFilePath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, completeFileName)
		if err := os.Remove(completeFilePath); err != nil {
			t.Fatalf("failed to remove %q: %s", completeFileName, err)
		}
		if err := manager.Restore(snapshot.ID); !errors.Is(err, ErrIncompleteSnapshot) {
			t.Errorf("did not return expected error; actual error: %s", err)
		}
	})
}
