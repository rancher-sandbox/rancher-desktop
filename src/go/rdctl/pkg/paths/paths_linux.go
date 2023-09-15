package paths

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func GetPaths(getResourcesPathFuncs ...func() (string, error)) (Paths, error) {
	var getResourcesPathFunc func() (string, error)
	switch len(getResourcesPathFuncs) {
	case 0:
		getResourcesPathFunc = getResourcesPath
	case 1:
		getResourcesPathFunc = getResourcesPathFuncs[0]
	default:
		return Paths{}, errors.New("you can only pass one function in getResourcesPathFuncs arg")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, fmt.Errorf("failed to get user home directory: %w", err)
	}
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		dataHome = filepath.Join(homeDir, ".local", "share")
	}
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		configHome = filepath.Join(homeDir, ".config")
	}
	cacheHome := os.Getenv("XDG_CACHE_HOME")
	if cacheHome == "" {
		cacheHome = filepath.Join(homeDir, ".cache")
	}
	altAppHome := filepath.Join(homeDir, ".rd")
	paths := Paths{
		AppHome:                 filepath.Join(dataHome, appName),
		AltAppHome:              altAppHome,
		Config:                  filepath.Join(configHome, appName),
		Cache:                   filepath.Join(cacheHome, appName),
		Lima:                    filepath.Join(dataHome, appName, "lima"),
		Integration:             filepath.Join(altAppHome, "bin"),
		DeploymentProfileSystem: filepath.Join("/etc", appName),
		DeploymentProfileUser:   configHome,
		ExtensionRoot:           filepath.Join(dataHome, appName, "extensions"),
		Snapshots:               filepath.Join(dataHome, appName, "snapshots"),
	}
	paths.Logs = os.Getenv("RD_LOGS_DIR")
	if paths.Logs == "" {
		paths.Logs = filepath.Join(dataHome, appName, "logs")
	}
	paths.Resources, err = getResourcesPathFunc()
	if err != nil {
		return Paths{}, fmt.Errorf("failed to find resources directory: %w", err)
	}

	return paths, nil
}
