package factoryreset

import (
	"os"
	"path/filepath"
	"strings"

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
	dataDir := os.Getenv("XDG_DATA_HOME")
	if dataDir == "" {
		dataDir = filepath.Join(homeDir, ".local", "share")
	}
	dataHomePath := filepath.Join(dataDir, "rancher-desktop")

	// Electron stores things in ~/.config/Rancher Desktop. This is difficult
	// to change. We should still clean up the directory on factory reset.
	configPath, err := os.UserConfigDir()
	if err != nil {
		logrus.Errorf("Error getting config directory: %s", err)
	}
	electronConfigPath := filepath.Join(configPath, "Rancher Desktop")

	pathList := []string{
		paths.AltAppHome,
		paths.Config,
		electronConfigPath,
		filepath.Join(homeDir, ".local", "state", "rancher-desktop"),
		dataHomePath,
	}
	if !strings.HasPrefix(paths.Logs, dataHomePath) {
		pathList = append(pathList, paths.Logs)
	}
	if removeKubernetesCache {
		pathList = append(pathList, paths.Cache)
	} else {
		pathList = append(pathList, filepath.Join(paths.Cache, "updater-longhorn.json"))
	}
	return deleteUnixLikeData(paths, pathList)
}
