package factoryreset

import (
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/autostart"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/sirupsen/logrus"
)

func DeleteData(paths paths.Paths, removeKubernetesCache bool) error {
	if err := autostart.EnsureAutostart(false); err != nil {
		logrus.Errorf("Failed to remove autostart configuration: %s", err)
	}

	pathList := []string{
		paths.AltAppHome,
		paths.AppHome,
		paths.Logs,
		paths.Config,
	}

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
		pathList = append(pathList, paths.Cache)
	} else {
		pathList = append(pathList, filepath.Join(paths.Cache, "updater-longhorn.json"))
	}
	return deleteUnixLikeData(paths, pathList)
}
