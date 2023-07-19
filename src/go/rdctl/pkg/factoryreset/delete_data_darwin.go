package factoryreset

import (
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/autostart"
	"github.com/sirupsen/logrus"
	"os"
	"path"
)

func DeleteData(removeKubernetesCache bool) error {
	if err := autostart.EnsureAutostart(false); err != nil {
		logrus.Errorf("Failed to remove autostart configuration: %s", err)
	}

	configDir, cacheDir, homeDir, err := getStandardDirs()
	if err != nil {
		return err
	}
	libraryPath := path.Join(homeDir, "Library")

	altAppHomePath := path.Join(homeDir, ".rd")
	appHomePath := path.Join(configDir, "rancher-desktop")
	cachePath := path.Join(cacheDir, "rancher-desktop")
	logsPath := os.Getenv("RD_LOGS_DIR")
	if logsPath == "" {
		logsPath = path.Join(libraryPath, "Logs", "rancher-desktop")
	}
	settingsPath := path.Join(libraryPath, "Preferences", "rancher-desktop")
	updaterPath := path.Join(configDir, "Caches", "rancher-desktop-updater")

	pathList := []string{
		altAppHomePath,
		appHomePath,
		logsPath,
		settingsPath,
		updaterPath,
	}
	if removeKubernetesCache {
		pathList = append(pathList, cachePath)
	} else {
		pathList = append(pathList, path.Join(cachePath, "updater-longhorn.json"))
	}
	return deleteUnixLikeData(homeDir, altAppHomePath, path.Join(homeDir, ".config"), pathList)
}
