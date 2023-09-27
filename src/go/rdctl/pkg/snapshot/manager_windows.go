package snapshot

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"io"
	"os"
	"os/exec"
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

// Note: on Windows, there are syscalls such as CopyFile and CopyFileEx
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

func createFiles(paths paths.Paths, snapshot Snapshot) error {
	// ensure snapshot directory is created
	snapshotDir := filepath.Join(paths.Snapshots, snapshot.ID)
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return fmt.Errorf("failed to create snapshot directory %q: %w", snapshotDir, err)
	}

	// export WSL distros to snapshot directory
	for _, distro := range getWslDistros(paths) {
		snapshotDistroPath := filepath.Join(snapshotDir, distro.Name+".vhdx")
		cmd := exec.Command("wsl.exe", "--export", "--vhd", distro.Name, snapshotDistroPath)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to export WSL distro %q: %w", distro.Name, err)
		}
	}

	// copy settings.json to snapshot directory
	workingSettingsPath := filepath.Join(paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(paths.Snapshots, snapshot.ID, "settings.json")
	if err := copyFile(snapshotSettingsPath, workingSettingsPath); err != nil {
		return fmt.Errorf("failed to copy %q to snapshot directory: %w", workingSettingsPath, err)
	}

	if err := writeMetadataFile(paths, snapshot); err != nil {
		return err
	}
	return nil
}

func restoreFiles(paths paths.Paths, snapshot Snapshot) error {
	// restore WSL distros
	if err := factoryreset.UnregisterWSL(); err != nil {
		return fmt.Errorf("failed to unregister WSL distros: %w", err)
	}
	snapshotDir := filepath.Join(paths.Snapshots, snapshot.ID)
	for _, distro := range getWslDistros(paths) {
		snapshotDistroPath := filepath.Join(snapshotDir, distro.Name+".vhdx")
		cmd := exec.Command("wsl.exe", "--import", distro.Name, distro.WorkingDirPath, snapshotDistroPath, "--vhd")
		if output, err := cmd.Output(); err != nil {
			fmt.Println(string(output))
			return fmt.Errorf("failed to import WSL distro %q: %w", distro.Name, err)
		}
	}

	// copy settings.json back to its working location
	workingSettingsPath := filepath.Join(paths.Config, "settings.json")
	snapshotSettingsPath := filepath.Join(paths.Snapshots, snapshot.ID, "settings.json")
	if err := copyFile(workingSettingsPath, snapshotSettingsPath); err != nil {
		return fmt.Errorf("failed to restore %q: %w", workingSettingsPath, err)
	}

	return nil
}
