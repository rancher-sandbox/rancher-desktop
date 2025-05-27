package paths

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
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
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(homeDir, "AppData", "Local")
	}
	appHome := filepath.Join(localAppData, appName)
	paths := Paths{
		AppHome:         appHome,
		AltAppHome:      appHome,
		Config:          appHome,
		Cache:           filepath.Join(localAppData, appName, "cache"),
		WslDistro:       filepath.Join(localAppData, appName, "distro"),
		WslDistroData:   filepath.Join(localAppData, appName, "distro-data"),
		ExtensionRoot:   filepath.Join(localAppData, appName, "extensions"),
		Snapshots:       filepath.Join(localAppData, appName, "snapshots"),
		ContainerdShims: filepath.Join(localAppData, appName, "containerd-shims"),
		OldUserData:     filepath.Join(localAppData, appName, "cache", "Rancher Desktop"),
	}
	paths.Logs = os.Getenv("RD_LOGS_DIR")
	if paths.Logs == "" {
		paths.Logs = filepath.Join(localAppData, appName, "logs")
	}
	paths.Resources, err = getResourcesPathFunc()
	if err != nil {
		return nil, fmt.Errorf("failed to find resources directory: %w", err)
	}

	return &paths, nil
}

// Given a list of paths, return the first one that is a valid executable.
func FindFirstExecutable(candidates ...string) (string, error) {
	errs := multierror.Append(nil, errors.New("search location exhausted"))
	for _, candidate := range candidates {
		_, err := os.Stat(candidate)
		if err == nil {
			return candidate, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("failed to check existence of %q: %w", candidate, err)
		}
		errs = multierror.Append(errs, fmt.Errorf("%s is not suitable", candidate))
	}
	return "", errs.ErrorOrNil()
}

// Return the path used to launch Rancher Desktop.
func GetRDLaunchPath(ctx context.Context) (string, error) {
	appDir, err := directories.GetApplicationDirectory(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get application directory: %w", err)
	}
	dataDir, err := directories.GetLocalAppDataDirectory()
	if err != nil {
		return "", err
	}

	return FindFirstExecutable(
		filepath.Join(appDir, "Rancher Desktop.exe"),
		filepath.Join(dataDir, "Programs", "Rancher Desktop", "Rancher Desktop.exe"),
	)
}

// Return the path to the main Rancher Desktop executable.
// In the case of `yarn dev`, this would be the electron executable.
func GetMainExecutable(ctx context.Context) (string, error) {
	appDir, err := directories.GetApplicationDirectory(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get application directory: %w", err)
	}
	return FindFirstExecutable(
		filepath.Join(appDir, "Rancher Desktop.exe"),
		filepath.Join(appDir, "node_modules", "electron", "dist", "electron.exe"),
	)
}
