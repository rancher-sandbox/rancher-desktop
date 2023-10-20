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

	t.Run("ValidateName should disallow two snapshots with the same name, but only when the first is complete", func(t *testing.T) {
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
		if err := manager.ValidateName(snapshotName); err == nil {
			t.Fatalf("name validation failed to return error when complete snapshot with name %q exists", snapshotName)
		}
		completeFilePath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, completeFileName)
		if err := os.Remove(completeFilePath); err != nil {
			t.Fatalf("failed to remove %q from first snapshot: %s", completeFileName, err)
		}
		if err := manager.ValidateName(snapshotName); err != nil {
			t.Fatalf("name validation returned error when complete snapshot with name %q does not exist: %s", snapshotName, err)
		}
	})

	t.Run("ValidateName should disallow invalid names", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		oversizeName :=
			// 251 characters is too long (and the indentation here is what our linter demands)
			"12345678911234567892123456789312345678941234567895123456789612345678971234567898" +
				"12345678991234567890123456789112345678921234567893123456789412345678951234567896" +
				"12345678971234567898123456789912345678901234567891123456789212345678931234567894" +
				"12345678951"
		nameWithTab := "can't contain a \t tab"
		invalidNames := []string{
			"", // empty string not allowed
			" can't start with a space",
			`can't end with a "space" `,
			oversizeName,
			nameWithTab,
			"can't contain a \n newline",
			"can't contain a \r carriage-return",
			"can't contain a \x00 null-byte",
			"can't contain a \x07 control character",
		}
		for _, invalidName := range invalidNames {
			if err := manager.ValidateName(invalidName); err == nil {
				t.Errorf("name %q is invalid but no error was returned", invalidName)
			}
		}
		// The above loop verifies that each invalid name is found invalid.
		// The following code verifies that we get the actual
		err := manager.ValidateName(oversizeName)
		if err == nil {
			t.Error("oversize name is invalid but no error was returned")
		} else if !strings.Contains(err.Error(), "…") {
			t.Errorf("No ellipsis in reported name")
		}
		err = manager.ValidateName(nameWithTab)
		if err == nil {
			t.Error("name with tab is invalid but no error was returned")
		} else if !strings.Contains(err.Error(), "invalid character value 9 at position 16 in name: all characters must be printable or a space") {
			t.Errorf("failed to report unprintable character in name, got %s", err.Error())
		}
		longishNameEndingWithSpace := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ "
		endOfLongishString := longishNameEndingWithSpace[len(longishNameEndingWithSpace)-nameDisplayCutoffSize:]
		err = manager.ValidateName(longishNameEndingWithSpace)
		if err == nil {
			t.Error(" name ending with space not caught")
		} else if !strings.Contains(err.Error(), "…"+endOfLongishString) {
			t.Errorf("Longish invalid name not truncated as expected")
		}
	})

	t.Run("Should create these valid names", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		validNames := []string{
			`no "spaces" at either end`,
			// 250 characters is ok
			"12345678911234567892123456789312345678941234567895123456789612345678971234567898" +
				"12345678991234567890123456789112345678921234567893123456789412345678951234567896" +
				"12345678971234567898123456789912345678901234567891123456789212345678931234567894" +
				"1234567895",
			"french student: élève",
		}
		for _, validName := range validNames {
			if err := manager.ValidateName(validName); err != nil {
				t.Errorf("Name %s should be valid", validName)
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

	t.Run("Restore should return an error if asked to restore a nonexistent snapshot", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		if err := manager.Restore("no-such-snapshot-id"); err == nil {
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
