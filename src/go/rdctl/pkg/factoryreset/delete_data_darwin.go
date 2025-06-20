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

	if err := process.TerminateProcessInDirectory(appPaths.ExtensionRoot, false); err != nil {
		logrus.Errorf("Failed to stop extension processes, ignoring: %s", err)
	}

	pathList := []string{
		appPaths.AltAppHome,
		appPaths.Config,
		appPaths.Logs,
		appPaths.ExtensionRoot,
		appPaths.OldUserData,
	}
	pathList = append(pathList, appHomeDirectories(appPaths)...)

	// Get path that electron-updater stores cache data in. Technically this
	// is the wrong directory to use for cache data, but it is set by electron-updater.
	// TODO: investigate changing the directory electron-updater uses
	configDir, err := os.UserConfigDir()
	if err != nil {
		logrus.Errorf("failed to get config dir: %s", err)
	} else {
		pathList = append(pathList, filepath.Join(configDir, "Caches", "rancher-desktop-updater"))
	}

	if removeKubernetesCache {
		pathList = append(pathList, appPaths.Cache)
	} else {
		pathList = append(pathList, filepath.Join(appPaths.Cache, "updater-longhorn.json"))
	}
	return deleteUnixLikeData(appPaths, pathList)
}
