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

	configHomePath, cacheHomePath, homeDir, err := getStandardDirs()
	if err != nil {
		return err
	}

	dataDir := os.Getenv("XDG_DATA_HOME")
	if dataDir == "" {
		dataDir = path.Join(homeDir, ".local", "share")
	}
	altAppHomePath := path.Join(homeDir, ".rd")
	cachePath := path.Join(cacheHomePath, "rancher-desktop")
	configPath := path.Join(configHomePath, "rancher-desktop")
	electronConfigPath := path.Join(configHomePath, "Rancher Desktop")
	dataHomePath := path.Join(dataDir, "rancher-desktop")

	pathList := []string{
		altAppHomePath,
		configPath,
		electronConfigPath,
		path.Join(homeDir, ".local", "state", "rancher-desktop"),
	}
	logsPath := os.Getenv("RD_LOGS_DIR")
	if logsPath != "" {
		pathList = append(pathList, logsPath, path.Join(dataHomePath, "lima"))
	} else {
		pathList = append(pathList, path.Join(dataHomePath))
	}
	if removeKubernetesCache {
		pathList = append(pathList, cachePath)
	} else {
		pathList = append(pathList, path.Join(cachePath, "updater-longhorn.json"))
	}
	return deleteUnixLikeData(homeDir, altAppHomePath, configHomePath, pathList)
}
