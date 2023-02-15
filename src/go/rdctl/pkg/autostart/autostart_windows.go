package autostart

import (
	"errors"
	"fmt"
	"os"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
	"golang.org/x/sys/windows/registry"
)

const relativeKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const nameValue = "RancherDesktop"

var absoluteKey string

func init() {
	absoluteKey = fmt.Sprintf(`%s\%s`, "HKCU", relativeKey)
}

func EnsureAutostart(autostartDesired bool) error {
	autostartKey, err := registry.OpenKey(registry.CURRENT_USER, relativeKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key: %w", err)
	}
	defer autostartKey.Close()

	if autostartDesired {
		rdctlPath, err := os.Executable()
		if err != nil {
			return fmt.Errorf("failed to get path to rdctl: %w", err)
		}
		rancherDesktopPath := utils.GetWindowsRDPath(rdctlPath)
		if rancherDesktopPath == "" {
			return errors.New("failed to get path to Rancher Desktop.exe")
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
