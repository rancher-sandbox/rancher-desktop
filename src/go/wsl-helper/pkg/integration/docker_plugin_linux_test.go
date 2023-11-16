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

package integration_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/integration"
)

func TestDockerPlugin(t *testing.T) {
	t.Run("create symlink", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, integration.DockerPlugin(pluginPath, true))
		link, err := os.Readlink(destPath)
		if assert.NoError(t, err, "error reading created symlink") {
			assert.Equal(t, pluginPath, link)
		}
	})
	t.Run("remove dangling symlink", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, os.MkdirAll(filepath.Dir(destPath), 0o755))
		require.NoError(t, os.Symlink(filepath.Join(pluginDir, "missing"), destPath))
		require.NoError(t, integration.DockerPlugin(pluginPath, true))
		link, err := os.Readlink(destPath)
		if assert.NoError(t, err, "error reading created symlink") {
			assert.Equal(t, pluginPath, link)
		}
	})
	t.Run("leave existing symlink", func(t *testing.T) {
		executable, err := os.Executable()
		require.NoError(t, err, "failed to locate executable")
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, os.MkdirAll(filepath.Dir(destPath), 0o755))
		require.NoError(t, os.Symlink(executable, destPath))
		require.NoError(t, integration.DockerPlugin(pluginPath, true))
		link, err := os.Readlink(destPath)
		if assert.NoError(t, err, "error reading created symlink") {
			assert.Equal(t, executable, link)
		}
	})
	t.Run("leave existing file", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, os.MkdirAll(filepath.Dir(destPath), 0o755))
		require.NoError(t, os.WriteFile(destPath, []byte("hello"), 0o644))
		require.NoError(t, integration.DockerPlugin(pluginPath, true))
		buf, err := os.ReadFile(destPath)
		if assert.NoError(t, err, "failed to read destination file") {
			assert.Equal(t, []byte("hello"), buf)
		}
	})
	t.Run("remove correct symlink", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, os.MkdirAll(filepath.Dir(destPath), 0o755))
		require.NoError(t, os.Symlink(pluginPath, destPath))
		require.NoError(t, integration.DockerPlugin(pluginPath, false))
		_, err := os.Lstat(destPath)
		assert.ErrorIs(t, err, os.ErrNotExist, "symlink was not removed")
	})
	t.Run("do not remove incorrect symlink", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, os.MkdirAll(filepath.Dir(destPath), 0o755))
		require.NoError(t, os.Symlink(destPath, destPath))
		require.NoError(t, integration.DockerPlugin(pluginPath, false))
		result, err := os.Readlink(destPath)
		if assert.NoError(t, err, "error reading symlink") {
			assert.Equal(t, destPath, result, "unexpected symlink contents")
		}
	})
	t.Run("do not remove file", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginDir := t.TempDir()
		pluginPath := filepath.Join(pluginDir, "docker-something")
		destPath := filepath.Join(homeDir, ".docker", "cli-plugins", "docker-something")
		t.Setenv("HOME", homeDir)

		require.NoError(t, os.MkdirAll(filepath.Dir(destPath), 0o755))
		require.NoError(t, os.WriteFile(destPath, []byte("hello"), 0o644))
		require.NoError(t, integration.DockerPlugin(pluginPath, false))
		buf, err := os.ReadFile(destPath)
		if assert.NoError(t, err, "failed to read destination file") {
			assert.Equal(t, []byte("hello"), buf)
		}
	})
}
