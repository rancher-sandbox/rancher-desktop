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

	homeDir, err := os.UserHomeDir()
	if err != nil {
		logrus.Errorf("Error getting home directory: %s", err)
	}

	pathList := []string{
		paths.AltAppHome,
		paths.Config,
		paths.Logs,
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
		pathList = append(pathList, paths.Cache)
	} else {
		pathList = append(pathList, filepath.Join(paths.Cache, "updater-longhorn.json"))
	}
	appHomeDirs := addAppHomeWithoutSnapshots(paths.AppHome)
	pathList = append(pathList, appHomeDirs...)
	return deleteUnixLikeData(paths, pathList)
}
