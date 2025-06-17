package autostart

import (
	"context"
	"errors"
	"fmt"

	"golang.org/x/sys/windows/registry"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

const relativeKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const nameValue = "RancherDesktop"

var absoluteKey string

func init() {
	absoluteKey = fmt.Sprintf(`%s\%s`, "HKCU", relativeKey)
}

func EnsureAutostart(ctx context.Context, autostartDesired bool) error {
	autostartKey, err := registry.OpenKey(registry.CURRENT_USER, relativeKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key: %w", err)
	}
	defer autostartKey.Close()

	if autostartDesired {
		rancherDesktopPath, err := paths.GetRDLaunchPath(ctx)
		if err != nil {
			return fmt.Errorf("failed to get path to Rancher Desktop.exe: %w", err)
		}
		err = autostartKey.SetStringValue(nameValue, rancherDesktopPath)
		if err != nil {
			return fmt.Errorf("failed to set name value %q of registry key %q: %w", nameValue, absoluteKey, err)
		}
	} else {
		err = autostartKey.DeleteValue(nameValue)
		if err != nil && !errors.Is(err, registry.ErrNotExist) {
			return fmt.Errorf("failed to remove name value %q of registry key %q: %w", nameValue, absoluteKey, err)
		}
	}

	return nil
}
