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
	appHome := filepath.Join(homeDir, "Library", "Application Support", appName)
	altAppHome := filepath.Join(homeDir, ".rd")
	paths := Paths{
		AppHome:                 appHome,
		AltAppHome:              altAppHome,
		Config:                  filepath.Join(homeDir, "Library", "Preferences", appName),
		Cache:                   filepath.Join(homeDir, "Library", "Caches", appName),
		Lima:                    filepath.Join(appHome, "lima"),
		Integration:             filepath.Join(altAppHome, "bin"),
		DeploymentProfileSystem: "/Library/Preferences",
		DeploymentProfileUser:   filepath.Join(homeDir, "Library", "Preferences"),
		ExtensionRoot:           filepath.Join(appHome, "extensions"),
		Snapshots:               filepath.Join(appHome, "snapshots"),
		ContainerdShims:         filepath.Join(appHome, "containerd-shims"),
		OldUserData:             filepath.Join(homeDir, "Library", "Application Support", "Rancher Desktop"),
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
