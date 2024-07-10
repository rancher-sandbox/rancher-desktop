package snapshot

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/runner"
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
		snapshot, err := manager.Create(context.Background(), snapshotName, "")
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

	testCases := []struct {
		Name          string
		ExpectedError string
		// When the name we are validating is above a certain length, it should
		// be truncated to a certain length in the error message. Otherwise, it
		// should be left as is.
		ExpectedErrMsgName string
	}{
		{
			Name:          "", // empty string not allowed
			ExpectedError: "snapshot name must not be the empty string",
		},
		{
			Name:               " can't start with a space",
			ExpectedError:      "must not start with a white-space character",
			ExpectedErrMsgName: " can't start with a space",
		},
		{
			Name:               " 12345678911234567892123456我喜欢鸡肉",
			ExpectedError:      "must not start with a white-space character",
			ExpectedErrMsgName: " 12345678911234567892123456我喜…",
		},
		{
			Name:               `can't end with a "space" `,
			ExpectedError:      "must not end with a white-space character",
			ExpectedErrMsgName: `can't end with a "space" `,
		},
		{
			Name:               `我喜欢鸡肉1234567891123456789212345 `,
			ExpectedError:      "must not end with a white-space character",
			ExpectedErrMsgName: `…喜欢鸡肉1234567891123456789212345 `,
		},
		{
			Name:               "filename_too_long_workaround",
			ExpectedError:      "max length is",
			ExpectedErrMsgName: "12345678911234567892123456789…",
		},
		{
			Name:          "can't contain a \t tab",
			ExpectedError: `invalid character '\t' at position 16 in name: all characters must be printable or a space`,
		},
		{
			Name:          "can't contain a \n newline",
			ExpectedError: `invalid character '\n' at position 16 in name: all characters must be printable or a space`,
		},
		{
			Name:          "can't contain a \r carriage-return",
			ExpectedError: `invalid character '\r' at position 16 in name: all characters must be printable or a space`,
		},
		{
			Name:          "can't contain a \x00 null-byte",
			ExpectedError: `invalid character '\x00' at position 16 in name: all characters must be printable or a space`,
		},
		{
			Name:          "can't contain a \a control character",
			ExpectedError: `invalid character '\a' at position 16 in name: all characters must be printable or a space`,
		},
	}
	for _, testCase := range testCases {
		description := fmt.Sprintf("ValidateName should disallow invalid names (case %+v)", testCase)
		t.Run(description, func(t *testing.T) {
			paths, _ := populateFiles(t, true)
			manager := newTestManager(paths)
			// The test case name is used in the name of a file inside the temporary
			// directory, which means it is limited in length. Work around this.
			if testCase.Name == "filename_too_long_workaround" {
				// 251 characters is too long (and the indentation here is what our linter demands)
				testCase.Name = "12345678911234567892123456789312345678941234567895123456789612345678971234567898" +
					"12345678991234567890123456789112345678921234567893123456789412345678951234567896" +
					"12345678971234567898123456789912345678901234567891123456789212345678931234567894" +
					"12345678951"
			}
			err := manager.ValidateName(testCase.Name)
			if err == nil {
				t.Errorf("expected error but got err == nil")
			} else if !strings.Contains(err.Error(), testCase.ExpectedError) {
				t.Errorf("unexpected error %q", err)
			}
			// check that we are truncating the name properly in the error message
			if len(testCase.ExpectedErrMsgName) > 0 {
				if !strings.Contains(err.Error(), strconv.Quote(testCase.ExpectedErrMsgName)) {
					t.Errorf("error %q does not contain name %q", err, strconv.Quote(testCase.ExpectedErrMsgName))
				}
			}
		})
	}

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
			"我喜欢鸡肉",
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
			var lastSnapshot Snapshot
			for i := range []int{1, 2, 3} {
				snapshotName := fmt.Sprintf("test-snapshot-%d", i)
				snapshot, err := manager.Create(context.Background(), snapshotName, "")
				if err != nil {
					t.Fatalf("failed to create snapshot %q: %s", snapshotName, err)
				}
				lastSnapshot = snapshot
			}
			lastSnapshotCompleteFilePath := filepath.Join(manager.SnapshotDirectory(lastSnapshot), completeFileName)
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
		snapshot, err := manager.Create(context.Background(), "test-snapshot-delete", "")
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
		if err := manager.Delete(snapshot.Name); err != nil {
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
		if err := manager.Restore(context.Background(), "no-such-snapshot-id"); err == nil {
			t.Errorf("Failed to complain when asked to restore a nonexistent snapshot")
		}
	})

	t.Run("Restore should return the proper error if asked to restore from an incomplete snapshot", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshot, err := manager.Create(context.Background(), "test-snapshot-restore-incomplete", "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		completeFilePath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, completeFileName)
		if err := os.Remove(completeFilePath); err != nil {
			t.Fatalf("failed to remove %q: %s", completeFileName, err)
		}
		if err := manager.Restore(context.Background(), snapshot.Name); err == nil {
			t.Errorf("Failed to complain when asked to restore an incomplete snapshot")
		}
	})

	t.Run("Restore should return proper error and not run RestoreFiles when context is already cancelled", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshotName := "test-snapshot-restore-cancelled"
		_, err := manager.Create(context.Background(), snapshotName, "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := manager.Restore(ctx, snapshotName); !errors.Is(err, runner.ErrContextDone) {
			t.Errorf("Error is of unexpected type: %q", err)
		}
	})

	t.Run("Restore should return data reset error when RestoreFiles encounters an error and resets data", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshotName := "test-snapshot-error"
		snapshot, err := manager.Create(context.Background(), snapshotName, "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		snapshotSettingsPath := filepath.Join(paths.Snapshots, snapshot.ID, "settings.json")
		if err := os.RemoveAll(snapshotSettingsPath); err != nil {
			t.Fatalf("failed to remove settings.json: %s", err)
		}
		if err := manager.Restore(context.Background(), snapshotName); !errors.Is(err, ErrDataReset) {
			t.Errorf("Error is of unexpected type: %q", err)
		}
	})
}
