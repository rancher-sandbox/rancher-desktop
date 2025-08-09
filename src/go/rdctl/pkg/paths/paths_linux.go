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
		AppHome:     filepath.Join(dataHome, appName),
		AltAppHome:  altAppHome,
		Config:      filepath.Join(configHome, appName),
		Cache:       filepath.Join(cacheHome, appName),
		Lima:        filepath.Join(dataHome, appName, "lima"),
		Integration: filepath.Join(altAppHome, "bin"),
		//nolint:gocritic // filepathJoin doesn't like absolute paths
		DeploymentProfileSystem: filepath.Join("/etc", appName),
		//nolint:gocritic // filepathJoin doesn't like absolute paths
		AltDeploymentProfileSystem: filepath.Join("/usr/etc", appName),
		DeploymentProfileUser:      configHome,
		ExtensionRoot:              filepath.Join(dataHome, appName, "extensions"),
		Snapshots:                  filepath.Join(dataHome, appName, "snapshots"),
		ContainerdShims:            filepath.Join(dataHome, appName, "containerd-shims"),
		OldUserData:                filepath.Join(configHome, "Rancher Desktop"),
	}
	paths.Logs = os.Getenv("RD_LOGS_DIR")
	if paths.Logs == "" {
		paths.Logs = filepath.Join(dataHome, appName, "logs")
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
	candidatePaths := []string{
		filepath.Join(appDir, "rancher-desktop"),
		"/opt/rancher-desktop/rancher-desktop",
	}
	for _, candidatePath := range candidatePaths {
		usable, err := checkUsableApplication(candidatePath, true)
		if err != nil {
			return "", fmt.Errorf("failed to check usability of %q: %w", candidatePath, err)
		}
		if usable {
			return candidatePath, nil
		}
		errs = multierror.Append(errs, fmt.Errorf("%s is not suitable", candidatePath))
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
		filepath.Join(appDir, "rancher-desktop"),
		filepath.Join(appDir, "node_modules", "electron", "dist", "electron"),
	)
}
