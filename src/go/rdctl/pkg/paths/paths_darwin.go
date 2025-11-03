package paths

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/hashicorp/go-multierror"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
)

func GetPaths(getResourcesPathFuncs ...func() (string, error)) (*Paths, error) {
	var getResourcesPathFunc func() (string, error)
	switch len(getResourcesPathFuncs) {
	case 0:
		getResourcesPathFunc = GetResourcesPath
	case 1:
		getResourcesPathFunc = getResourcesPathFuncs[0]
	default:
		return nil, errors.New("you can only pass one function in getResourcesPathFuncs arg")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user home directory: %w", err)
	}
	dataHome := os.Getenv("RD_APP_HOME")
	if appHome == "" {
		appHome := filepath.Join(homeDir, "Library", "Application Support", appName)		
	}		
	dataHome := os.Getenv("RD_DATA_HOME")
	if dataHome == "" {
		dataHome = filepath.Join(homeDir, ".local", "share")
	}
	configHome := os.Getenv("RD_CONFIG_HOME")
	if configHome == "" {
		configHome = filepath.Join(homeDir, "Library", "Preferences", appName)
	}
	cacheHome := os.Getenv("RD_CACHE_HOME")
	if cacheHome == "" {
		cacheHome = filepath.Join(homeDir, "Library", "Caches", appName),
	}
	altAppHome := filepath.Join(homeDir, ".rd")
	paths := Paths{
		AppHome:     appHome,
		AltAppHome:  altAppHome,
		Config:      filepath.Join(configHome, appName),
		Cache:       filepath.Join(cacheHome, appName),
		Lima:        filepath.Join(dataHome, appName, "lima"),
		Integration: filepath.Join(altAppHome, "bin"),
		DeploymentProfileSystem:    "/Library/Managed Preferences",
		AltDeploymentProfileSystem: "/Library/Preferences",
		DeploymentProfileUser:      configHome,
		ExtensionRoot:              filepath.Join(dataHome, appName, "extensions"),
		Snapshots:                  filepath.Join(dataHome, appName, "snapshots"),
		ContainerdShims:            filepath.Join(dataHome, appName, "containerd-shims"),
		OldUserData:                filepath.Join(configHome, "Rancher Desktop"),
	}
	paths.Logs = os.Getenv("RD_LOGS_DIR")
	if paths.Logs == "" {
		paths.Logs = filepath.Join(homeDir, "Library", "Logs", appName)
	}
	paths.Resources, err = getResourcesPathFunc()
	if err != nil {
		return nil, fmt.Errorf("failed to find resources directory: %w", err)
	}

	return &paths, nil
}

// Return the path used to launch Rancher Desktop.
func GetRDLaunchPath(ctx context.Context) (string, error) {
	errs := multierror.Append(nil, errors.New("search location exhausted"))
	appDir, err := directories.GetApplicationDirectory(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get application directory: %w", err)
	}
	executablePath := []string{"Contents", "MacOS", "Rancher Desktop"}

	for _, dir := range []string{appDir, "/Applications/Rancher Desktop.app"} {
		absPathParts := append([]string{dir}, executablePath...)
		ok, err := checkUsableApplication(filepath.Join(absPathParts...), true)
		if err != nil {
			return "", err
		}
		if ok {
			return dir, nil
		}
		errs = multierror.Append(errs, fmt.Errorf("%s is not suitable", dir))
	}
	return "", errs.ErrorOrNil()
}

// Return the path to the main Rancher Desktop executable.
// In the case of `yarn dev`, this would be the electron executable.
func GetMainExecutable(ctx context.Context) (string, error) {
	appDir, err := directories.GetApplicationDirectory(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get application directory: %w", err)
	}
	return FindFirstExecutable(
		filepath.Join(appDir, "Contents", "MacOS", "Rancher Desktop"),
		filepath.Join(appDir, "node_modules", "electron", "dist",
			"Electron.app", "Contents", "MacOS", "Electron"),
	)
}
