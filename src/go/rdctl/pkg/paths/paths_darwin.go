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
	appHome := filepath.Join(homeDir, "Library", "Application Support", appName)
	altAppHome := filepath.Join(homeDir, ".rd")
	paths := Paths{
		AppHome:                 appHome,
		AltAppHome:              altAppHome,
		Config:                  filepath.Join(homeDir, "Library", "Preferences", appName),
		Cache:                   filepath.Join(homeDir, "Library", "Caches", appName),
		Lima:                    filepath.Join(appHome, "lima"),
		Integration:             filepath.Join(altAppHome, "bin"),
		DeploymentProfileSystem: filepath.Join("/Library", "Preferences"),
		DeploymentProfileUser:   filepath.Join(homeDir, "Library", "Preferences"),
		ExtensionRoot:           filepath.Join(appHome, "extensions"),
		Snapshots:               filepath.Join(appHome, "snapshots"),
	}
	paths.Logs = os.Getenv("RD_LOGS_DIR")
	if paths.Logs == "" {
		paths.Logs = filepath.Join(homeDir, "Library", "Logs", appName)
	}
	paths.Resources, err = getResourcesPathFunc()
	if err != nil {
		return Paths{}, fmt.Errorf("failed to find resources directory: %w", err)
	}

	return paths, nil
}
