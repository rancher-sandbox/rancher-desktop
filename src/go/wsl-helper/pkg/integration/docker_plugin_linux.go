/*
Copyright © 2023 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package integration

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// DockerPlugin manages a specific docker plugin (given in pluginPath), either
// enabling it or disabling it in the WSL distribution the process is running in.
func DockerPlugin(pluginPath string, enabled bool) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("could not get home directory: %w", err)
	}
	pluginDir := filepath.Join(homeDir, ".docker", "cli-plugins")
	if err = os.MkdirAll(pluginDir, 0o755); err != nil {
		return fmt.Errorf("failed to create docker plugins directory: %w", err)
	}
	destPath := filepath.Join(pluginDir, filepath.Base(pluginPath))

	if enabled {
		if _, err := os.Readlink(destPath); err == nil {
			if _, err := os.Stat(destPath); errors.Is(err, os.ErrNotExist) {
				// The destination is a dangling symlink
				if err = os.Remove(destPath); err != nil {
					return fmt.Errorf("could not remove dangling symlink %q: %w", destPath, err)
				}
			}
		}

		if err = os.Symlink(pluginPath, destPath); err != nil {
			// ErrExist is fine, that means there's a user-created file there.
			if !errors.Is(err, os.ErrExist) {
				return fmt.Errorf("failed to create symlink %q: %w", destPath, err)
			}
		}
	} else {
		link, err := os.Readlink(destPath)
		if err == nil && link == pluginPath {
			if err = os.Remove(destPath); err != nil {
				return fmt.Errorf("failed to remove link %q: %w", destPath, err)
			}
		}
	}

	return nil
}
