//go:build unix

package snapshot

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

func populateFiles(t *testing.T, optionalFiles ...string) (p.Paths, map[string]TestFile) {
	baseDir := t.TempDir()
	paths := p.Paths{
		Config:    filepath.Join(baseDir, "config"),
		Lima:      filepath.Join(baseDir, "lima"),
		Snapshots: filepath.Join(baseDir, "snapshots"),
	}
	testFiles := map[string]TestFile{
		"settings.json": {
			Path:     filepath.Join(paths.Config, "settings.json"),
			Contents: `{"test": "settings.json"}`,
		},
		"basedisk": {
			Path:     filepath.Join(paths.Lima, "0", "basedisk"),
			Contents: "basedisk contents",
		},
		"user": {
			Path:     filepath.Join(paths.Lima, "_config", "user"),
			Contents: "user SSH key",
		},
		"user.pub": {
			Path:     filepath.Join(paths.Lima, "_config", "user.pub"),
			Contents: "user public SSH key",
		},
		"lima.yaml": {
			Path:     filepath.Join(paths.Lima, "0", "lima.yaml"),
			Contents: "this is yaml",
		},
	}
	if slices.Contains(optionalFiles, "override.yaml") {
		testFiles["override.yaml"] = TestFile{
			Path:     filepath.Join(paths.Lima, "_config", "override.yaml"),
			Contents: "test: override.yaml",
		}
	}
	if slices.Contains(optionalFiles, "diffdisk") {
		testFiles["diffdisk"] = TestFile{
			Path:     filepath.Join(paths.Lima, "0", "diffdisk"),
			Contents: "diffdisk contents",
		}
	}
	if slices.Contains(optionalFiles, "diffdisk.raw") {
		testFiles["diffdisk.raw"] = TestFile{
			Path:     filepath.Join(paths.Lima, "0", "diffdisk.raw"),
			Contents: "diffdisk.raw contents",
		}
	}
	for _, file := range testFiles {
		testDirectory := filepath.Dir(file.Path)
		if err := os.MkdirAll(testDirectory, 0o755); err != nil {
			t.Fatalf("failed to create dir %q: %s", testDirectory, err)
		}
		if err := os.WriteFile(file.Path, []byte(file.Contents), 0o644); err != nil {
			t.Fatalf("failed to create test file %q: %s", file.Path, err)
		}
	}
	return paths, testFiles
}

func newTestManager(paths p.Paths) Manager {
	return NewManager(paths)
}

func TestManagerUnix(t *testing.T) {
	createTestCases := [][]string{
		{"diffdisk"},
		{"diffdisk", "override.yaml"},
		{"diffdisk", "diffdisk.raw"},
		{"diffdisk.raw"},
	}
	for _, optionalFiles := range createTestCases {
		t.Run(fmt.Sprintf("Create with optional files %#v", optionalFiles), func(t *testing.T) {
			paths, _ := populateFiles(t, optionalFiles...)

			// create snapshot
			testManager := newTestManager(paths)
			snapshot, err := testManager.Create("test-snapshot", "")
			if err != nil {
				t.Fatalf("unexpected error creating snapshot: %s", err)
			}

			// ensure desired files are present
			snapshotFiles := []string{
				filepath.Join(paths.Snapshots, snapshot.ID, "settings.json"),
				filepath.Join(paths.Snapshots, snapshot.ID, "basedisk"),
				filepath.Join(paths.Snapshots, snapshot.ID, "metadata.json"),
			}
			if slices.Contains(optionalFiles, "override.yaml") {
				snapshotFiles = append(snapshotFiles, filepath.Join(paths.Snapshots, snapshot.ID, "override.yaml"))
			}
			diffdiskPresent := slices.Contains(optionalFiles, "diffdisk")
			diffdiskRawPresent := slices.Contains(optionalFiles, "diffdisk.raw")
			if diffdiskPresent && diffdiskRawPresent {
				snapshotFiles = append(snapshotFiles, filepath.Join(paths.Snapshots, snapshot.ID, "diffdisk.raw"))
			} else if diffdiskRawPresent {
				snapshotFiles = append(snapshotFiles, filepath.Join(paths.Snapshots, snapshot.ID, "diffdisk.raw"))
			} else if diffdiskPresent {
				snapshotFiles = append(snapshotFiles, filepath.Join(paths.Snapshots, snapshot.ID, "diffdisk"))
			}

			for _, file := range snapshotFiles {
				if _, err := os.ReadFile(file); err != nil {
					t.Errorf("file %q does not exist in snapshot: %s", file, err)
				}
			}
		})
	}

	restoreTestCases := [][]string{
		{"diffdisk"},
		{"diffdisk", "override.yaml"},
		{"diffdisk.raw"},
		{"diffdisk.raw", "override.yaml"},
	}
	for _, optionalFiles := range restoreTestCases {
		t.Run(fmt.Sprintf("Restore with optional files %#v", optionalFiles), func(t *testing.T) {
			paths, testFiles := populateFiles(t, optionalFiles...)
			manager := newTestManager(paths)
			snapshot, err := manager.Create("test-snapshot", "")
			if err != nil {
				t.Fatalf("failed to create snapshot: %s", err)
			}
			for testFileName, testFile := range testFiles {
				if err := os.WriteFile(testFile.Path, []byte(`{"something": "different"}`), 0o644); err != nil {
					t.Fatalf("failed to modify %s: %s", testFileName, err)
				}
			}
			if err := manager.Restore(snapshot.ID); err != nil {
				t.Fatalf("failed to restore snapshot: %s", err)
			}
			for testFileName, testFile := range testFiles {
				contents, err := os.ReadFile(testFile.Path)
				if err != nil {
					t.Fatalf("failed to read contents of %s: %s", testFileName, err)
				}
				if string(contents) != testFile.Contents {
					t.Errorf("contents of %s appear to have not been restored", testFileName)
				}
			}
		})
	}

	restoreDeleteTestCases := []struct {
		// The optional files that should be present in the created snapshot.
		OptionalFiles []string
		// The files that should be removed after restoration of the snapshot.
		RemovedFiles []string
	}{
		{
			OptionalFiles: []string{"diffdisk"},
			RemovedFiles:  []string{"diffdisk.raw", "override.yaml"},
		},
		{
			OptionalFiles: []string{"diffdisk", "diffdisk.raw"},
			RemovedFiles:  []string{"diffdisk", "override.yaml"},
		},
		{
			OptionalFiles: []string{"diffdisk.raw"},
			RemovedFiles:  []string{"diffdisk", "override.yaml"},
		},
	}
	for _, testCase := range restoreDeleteTestCases {
		description := fmt.Sprintf("Restore should delete %#v with optional files %#v", testCase.RemovedFiles, testCase.OptionalFiles)
		t.Run(description, func(t *testing.T) {
			// populate files, including all possible optional files
			possibleOptionalFiles := []string{"diffdisk", "diffdisk.raw", "override.yaml"}
			paths, testFiles := populateFiles(t, possibleOptionalFiles...)

			// delete files that are not in test case's optional files in order to
			// prepare for creating snapshot with only these files
			deletedFiles := make([]string, 0, len(possibleOptionalFiles))
			for _, possibleOptionalFile := range possibleOptionalFiles {
				if !slices.Contains(testCase.OptionalFiles, possibleOptionalFile) {
					deletedFiles = append(deletedFiles, possibleOptionalFile)
				}
			}
			for _, deletedFile := range deletedFiles {
				if err := os.RemoveAll(testFiles[deletedFile].Path); err != nil {
					t.Fatalf("failed to remove %q before snapshot creation: %s", deletedFile, err)
				}
			}

			// make snapshot
			manager := newTestManager(paths)
			snapshot, err := manager.Create("test-snapshot", "")
			if err != nil {
				t.Fatalf("failed to create snapshot: %s", err)
			}

			// re-create files that were deleted before creating snapshot so we can verify
			// that correct files are deleted after restore
			for _, deletedFile := range deletedFiles {
				removedFilePath := testFiles[deletedFile].Path
				newContents := fmt.Sprintf("new contents of %q", deletedFile)
				if err := os.WriteFile(removedFilePath, []byte(newContents), 0o644); err != nil {
					t.Fatalf("failed to repopulate %q: %s", deletedFile, err)
				}
			}

			// restore snapshot
			if err := manager.Restore(snapshot.ID); err != nil {
				t.Fatalf("failed to restore snapshot: %s", err)
			}

			// ensure the files that should have been removed were removed
			for _, removedFile := range testCase.RemovedFiles {
				removedFilePath := testFiles[removedFile].Path
				if _, err := os.Stat(removedFilePath); !errors.Is(err, os.ErrNotExist) {
					t.Errorf("file %q was not removed", removedFile)
				}
			}
		})
	}

	t.Run("Restore should create any needed parent directories", func(t *testing.T) {
		paths, _ := populateFiles(t, "diffdisk", "override.yaml")
		manager := newTestManager(paths)
		snapshot, err := manager.Create("test-snapshot", "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		for _, dir := range []string{paths.Config, paths.Lima} {
			if err := os.RemoveAll(dir); err != nil {
				t.Fatalf("failed to remove directory: %s", err)
			}
		}
		if err := manager.Restore(snapshot.ID); err != nil {
			t.Fatalf("failed to restore snapshot: %s", err)
		}
	})
}
