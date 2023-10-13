package snapshot

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/wsl"
)

func populateFiles(t *testing.T, _ bool) (p.Paths, map[string]TestFile) {
	baseDir := t.TempDir()
	paths := p.Paths{
		Config:        filepath.Join(baseDir, "config"),
		Snapshots:     filepath.Join(baseDir, "snapshots"),
		WslDistro:     filepath.Join(baseDir, "wslDistro"),
		WslDistroData: filepath.Join(baseDir, "wslDistroData"),
	}
	testFiles := map[string]TestFile{
		"settings.json": {
			Path:     filepath.Join(paths.Config, "settings.json"),
			Contents: `{"test": "settings.json"}`,
		},
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
	manager := NewManager(paths)
	snapshotter := NewSnapshotterImpl(paths)
	snapshotter.WSL = wsl.MockWSL{}
	manager.Snapshotter = snapshotter
	return manager
}

func TestManagerWindows(t *testing.T) {
	t.Run("Create should create the necessary files", func(t *testing.T) {
		paths, _ := populateFiles(t, false)

		// create snapshot
		testManager := newTestManager(paths)
		snapshot, err := testManager.Create("test-snapshot")
		if err != nil {
			t.Fatalf("unexpected error creating snapshot: %s", err)
		}

		// ensure desired files are present
		snapshotFiles := []string{
			filepath.Join(paths.Snapshots, snapshot.ID, "settings.json"),
			filepath.Join(paths.Snapshots, snapshot.ID, "metadata.json"),
		}
		for _, file := range snapshotFiles {
			if _, err := os.ReadFile(file); err != nil {
				t.Errorf("file %q does not exist in snapshot: %s", file, err)
			}
		}
	})

	t.Run("Restore should work properly", func(t *testing.T) {
		paths, testFiles := populateFiles(t, false)
		manager := newTestManager(paths)
		snapshot, err := manager.Create("test-snapshot")
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

	t.Run("Restore should create any needed parent directories", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshot, err := manager.Create("test-snapshot")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		testDirs := []string{
			paths.Config,
			paths.WslDistro,
			paths.WslDistroData,
		}
		for _, testDir := range testDirs {
			if err := os.RemoveAll(testDir); err != nil {
				t.Fatalf("failed to remove test directory %q: %s", testDir, err)
			}
		}
		if err := manager.Restore(snapshot.ID); err != nil {
			t.Fatalf("failed to restore snapshot: %s", err)
		}
		for _, testDir := range testDirs {
			if _, err := os.Stat(testDir); errors.Is(err, os.ErrNotExist) {
				t.Errorf("directory %q was not created", testDir)
			}
		}
	})
}
