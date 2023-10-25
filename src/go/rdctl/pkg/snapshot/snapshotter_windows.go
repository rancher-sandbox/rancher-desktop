package snapshot

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/wsl"
	"io"
	"os"
	"path/filepath"
)

type wslDistro struct {
	// The name of the WSL distro.
	Name string
	// The path to the directory that is used to store the
	// copy of the distro that is actually used by WSL.
	WorkingDirPath string
}

func getWslDistros(paths paths.Paths) []wslDistro {
	return []wslDistro{
		{
			Name:           "rancher-desktop",
			WorkingDirPath: paths.WslDistro,
		},
		{
			Name:           "rancher-desktop-data",
			WorkingDirPath: paths.WslDistroData,
		},
	}
}

// Note: on Windows, there are system calls such as CopyFile and CopyFileEx
// that may speed up the process of copying a file, but they appear to require
// loading DLL's. This approach works fine for copying smaller files, but if
// we need to copy big files it may be worth the complexity to use the syscall.
func copyFile(dst, src string) error {
	srcFd, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFd.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("failed to create destination parent dir: %w", err)
	}
	dstFd, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to open destination file: %w", err)
	}
	defer dstFd.Close()
	if _, err := io.Copy(dstFd, srcFd); err != nil {
		return fmt.Errorf("failed to copy contents of src to dst: %w", err)
	}
	return nil
}

type SnapshotterImpl struct {
	WSL   wsl.WSL
	Paths paths.Paths
}

func NewSnapshotterImpl(p paths.Paths) SnapshotterImpl {
	return SnapshotterImpl{
		WSL:   wsl.WSLImpl{},
		Paths: p,
	}
}

func (snapshotter SnapshotterImpl) CreateFiles(snapshot Snapshot) error {
	// Create metadata.json file. This happens first because creation
	// of subsequent files may take a while, and we always need to
	// have access to snapshot metadata.
	if err := writeMetadataFile(snapshotter.Paths, snapshot); err != nil {
		return err
	}

	// export WSL distros to snapshot directory
	for _, distro := range getWslDistros(snapshotter.Paths) {
		snapshotDistroPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, distro.Name+".tar")
		if err := snapshotter.WSL.ExportDistro(distro.Name, snapshotDistroPath); err != nil {
			return fmt.Errorf("failed to export WSL distro %q: %w", distro.Name, err)
		}
	}

	// copy settings.json to snapshot directory
	workingSettingsPath := filepath.Join(snapshotter.Paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, "settings.json")
	if err := copyFile(snapshotSettingsPath, workingSettingsPath); err != nil {
		return fmt.Errorf("failed to copy %q to snapshot directory: %w", workingSettingsPath, err)
	}

	// Create complete.txt file. This is done last because its presence
	// signifies a complete and valid snapshot.
	completeFilePath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, completeFileName)
	if err := os.WriteFile(completeFilePath, []byte(completeFileContents), 0o644); err != nil {
		return fmt.Errorf("failed to write %q: %w", completeFileName, err)
	}

	return nil
}

func (snapshotter SnapshotterImpl) RestoreFiles(snapshot Snapshot) error {
	// restore WSL distros
	var err error
	if err = snapshotter.WSL.UnregisterDistros(); err != nil {
		return fmt.Errorf("failed to unregister WSL distros: %w", err)
	}
	snapshotDir := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID)
	for _, distro := range getWslDistros(snapshotter.Paths) {
		snapshotDistroPath := filepath.Join(snapshotDir, distro.Name+".tar")
		if err = os.MkdirAll(distro.WorkingDirPath, 0o755); err != nil {
			err = fmt.Errorf("failed to create install directory for distro %q: %w", distro.Name, err)
			break
		}
		if err = snapshotter.WSL.ImportDistro(distro.Name, distro.WorkingDirPath, snapshotDistroPath); err != nil {
			err = fmt.Errorf("failed to import WSL distro %q: %w", distro.Name, err)
			break
		}
	}

	// copy settings.json back to its working location
	workingSettingsPath := filepath.Join(snapshotter.Paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(snapshotter.Paths.Snapshots, snapshot.ID, "settings.json")
	if err == nil {
		if err = copyFile(workingSettingsPath, snapshotSettingsPath); err != nil {
			err = fmt.Errorf("failed to restore %q: %w", workingSettingsPath, err)
		}
	}
	if err != nil {
		_ = os.Remove(workingSettingsPath)
		_ = snapshotter.WSL.UnregisterDistros()
	}
	return err
}
