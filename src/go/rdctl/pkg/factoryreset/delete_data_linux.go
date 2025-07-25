package factoryreset

import (
	"context"
	"os"
	"path/filepath"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/autostart"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
)

func DeleteData(ctx context.Context, appPaths *paths.Paths, removeKubernetesCache bool) error {
	if err := autostart.EnsureAutostart(ctx, false); err != nil {
		logrus.Errorf("Failed to remove autostart configuration: %s", err)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		logrus.Errorf("Error getting home directory: %s", err)
	}

	if err := process.TerminateProcessInDirectory(appPaths.ExtensionRoot, false); err != nil {
		logrus.Errorf("Failed to stop extension processes, ignoring: %s", err)
	}

	pathList := []string{
		appPaths.AltAppHome,
		appPaths.Config,
		appPaths.Logs,
		appPaths.OldUserData,
		filepath.Join(homeDir, ".local", "state", "rancher-desktop"),
	}

	// Electron stores things in ~/.config/Rancher Desktop. This is difficult
	// to change. We should still clean up the directory on factory reset.
	configPath, err := os.UserConfigDir()
	if err != nil {
		logrus.Errorf("Error getting config directory: %s", err)
	} else {
		pathList = append(pathList, filepath.Join(configPath, "Rancher Desktop"))
	}

	if removeKubernetesCache {
		pathList = append(pathList, appPaths.Cache)
	} else {
		pathList = append(pathList, filepath.Join(appPaths.Cache, "updater-longhorn.json"))
	}
	pathList = append(pathList, appHomeDirectories(appPaths)...)
	return deleteUnixLikeData(ctx, appPaths, pathList)
}
