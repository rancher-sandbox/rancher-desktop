/*
Copyright © 2024 SUSE LLC

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
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/integration"
)

func TestUpdateDockerConfig(t *testing.T) {
	t.Parallel()
	t.Run("create config file", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginPath := t.TempDir()

		assert.NoError(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, true))

		bytes, err := os.ReadFile(path.Join(homeDir, ".docker", "config.json"))
		require.NoError(t, err, "error reading docker CLI config")
		var config map[string]any
		require.NoError(t, json.Unmarshal(bytes, &config))

		value := config["cliPluginsExtraDirs"]
		require.Contains(t, config, "cliPluginsExtraDirs")
		require.Contains(t, value, pluginPath, "did not contain plugin path")
		credStore := config["credsStore"]
		require.Equal(t, credStore, "wincred.exe")
	})
	t.Run("update config file", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginPath := t.TempDir()
		configPath := path.Join(homeDir, ".docker", "config.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0o755))
		existingContents := []byte(`{"credsStore": "nothing"}`)
		require.NoError(t, os.WriteFile(configPath, existingContents, 0o644))

		require.NoError(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, true))

		bytes, err := os.ReadFile(path.Join(homeDir, ".docker", "config.json"))
		require.NoError(t, err, "error reading docker CLI config")
		var config map[string]any
		require.NoError(t, json.Unmarshal(bytes, &config))

		assert.Subset(t, config, map[string]any{"cliPluginsExtraDirs": []any{pluginPath}})
		assert.Subset(t, config, map[string]any{"credsStore": "wincred.exe"})
	})
	t.Run("do not add multiple instances", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginPath := t.TempDir()
		configPath := path.Join(homeDir, ".docker", "config.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0o755))

		expected := []any{"1", pluginPath, "2"}
		config := map[string]any{"cliPluginsExtraDirs": expected}
		existingContents, err := json.Marshal(config)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(configPath, existingContents, 0o644))
		config = make(map[string]any)

		require.NoError(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, true))

		bytes, err := os.ReadFile(configPath)
		require.NoError(t, err, "error reading docker CLI config")
		require.NoError(t, json.Unmarshal(bytes, &config))

		assert.Subset(t, config, map[string]any{"cliPluginsExtraDirs": expected})
	})
	t.Run("remove existing instances", func(t *testing.T) {
		homeDir := t.TempDir()
		pluginPath := t.TempDir()
		configPath := path.Join(homeDir, ".docker", "config.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0o755))

		config := map[string]any{"cliPluginsExtraDirs": []any{"1", pluginPath, "2"}}
		existingContents, err := json.Marshal(config)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(configPath, existingContents, 0o644))
		config = make(map[string]any)

		require.NoError(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, false))

		bytes, err := os.ReadFile(configPath)
		require.NoError(t, err, "error reading docker CLI config")
		require.NoError(t, json.Unmarshal(bytes, &config))

		assert.Subset(t, config, map[string]any{"cliPluginsExtraDirs": []any{"1", "2"}})
	})
	t.Run("do not modify invalid file", func(t *testing.T) {
		t.Parallel()
		t.Run("file is not JSON", func(t *testing.T) {
			homeDir := t.TempDir()
			pluginPath := t.TempDir()
			configPath := path.Join(homeDir, ".docker", "config.json")
			require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0o755))
			existingContents := []byte(`this is not JSON`)
			require.NoError(t, os.WriteFile(configPath, existingContents, 0o644))

			assert.Error(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, true))

			bytes, err := os.ReadFile(configPath)
			require.NoError(t, err, "error reading docker CLI config")
			assert.Equal(t, existingContents, bytes, "docker CLI config was changed")
		})
		t.Run("file contains invalid plugin dirs", func(t *testing.T) {
			homeDir := t.TempDir()
			pluginPath := t.TempDir()
			configPath := path.Join(homeDir, ".docker", "config.json")
			require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0o755))

			config := map[string]any{"cliPluginsExtraDirs": 500}
			existingContents, err := json.MarshalIndent(config, " \t ", "  \n\r  ")
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(configPath, existingContents, 0o644))

			require.Error(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, false))

			bytes, err := os.ReadFile(configPath)
			require.NoError(t, err, "error reading docker CLI config")
			// Since we should not have modified the file at all, the file should
			// still be byte-identical.
			assert.Equal(t, existingContents, bytes, "docker CLI config was modified")
		})
		t.Run("file contains non-string plugin dirs items", func(t *testing.T) {})
		homeDir := t.TempDir()
		pluginPath := t.TempDir()
		configPath := path.Join(homeDir, ".docker", "config.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0o755))

		items := []any{1, true, map[string]any{"hello": "world"}}
		config := map[string]any{"cliPluginsExtraDirs": items}
		existingContents, err := json.MarshalIndent(config, " \t ", "  \n\r  ")
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(configPath, existingContents, 0o644))

		require.Error(t, integration.UpdateDockerConfig(t.Context(), homeDir, pluginPath, false))

		bytes, err := os.ReadFile(configPath)
		require.NoError(t, err, "error reading docker CLI config")
		// Since we should not have modified the file at all, the file should
		// still be byte-identical.
		assert.Equal(t, existingContents, bytes, "docker CLI config was modified")
	})
}

func TestRemoveObsoletePluginSymlinks(t *testing.T) {
	t.Run("plugin directory does not exist", func(t *testing.T) {
		homeDir := t.TempDir()
		binPath := t.TempDir()
		assert.NoError(t, integration.RemoveObsoletePluginSymlinks(homeDir, binPath))
	})
	t.Run("leaves non-symlink plugins", func(t *testing.T) {
		homeDir := t.TempDir()
		binPath := t.TempDir()
		pluginDir := path.Join(homeDir, ".docker", "cli-plugins")
		assert.NoError(t, os.MkdirAll(pluginDir, 0o755))
		pluginPath := path.Join(pluginDir, "docker-plugin")
		assert.NoError(t, os.WriteFile(pluginPath, []byte{}, 0o755))
		assert.NoError(t, integration.RemoveObsoletePluginSymlinks(homeDir, binPath))
		contents, err := os.ReadFile(pluginPath)
		assert.NoError(t, err)
		assert.Empty(t, contents)
	})
	t.Run("leaves foreign symlinks", func(t *testing.T) {
		homeDir := t.TempDir()
		binPath := t.TempDir()
		pluginDir := path.Join(homeDir, ".docker", "cli-plugins")
		assert.NoError(t, os.MkdirAll(pluginDir, 0o755))
		pluginPath := path.Join(pluginDir, "docker-plugin")
		assert.NoError(t, os.Symlink("/usr/bin/true", pluginPath))
		assert.NoError(t, integration.RemoveObsoletePluginSymlinks(homeDir, binPath))
		symlinkTarget, err := os.Readlink(pluginPath)
		assert.NoError(t, err)
		assert.Equal(t, "/usr/bin/true", symlinkTarget)
	})
	t.Run("leaves self-referential symlinks", func(t *testing.T) {
		homeDir := t.TempDir()
		binPath := t.TempDir()
		pluginDir := path.Join(homeDir, ".docker", "cli-plugins")
		assert.NoError(t, os.MkdirAll(pluginDir, 0o755))
		pluginPath := path.Join(pluginDir, "docker-plugin")
		assert.NoError(t, os.Symlink(pluginPath, pluginPath))
		assert.NoError(t, integration.RemoveObsoletePluginSymlinks(homeDir, binPath))
		symlinkTarget, err := os.Readlink(pluginPath)
		assert.NoError(t, err)
		assert.Equal(t, pluginPath, symlinkTarget)
	})
	t.Run("removes symlinks", func(t *testing.T) {
		homeDir := t.TempDir()
		binPath := t.TempDir()
		pluginDir := path.Join(homeDir, ".docker", "cli-plugins")
		assert.NoError(t, os.MkdirAll(pluginDir, 0o755))
		pluginPath := path.Join(pluginDir, "docker-plugin")
		targetPath := path.Join(binPath, "does-not-exist")
		assert.NoError(t, os.Symlink(targetPath, pluginPath))
		assert.NoError(t, integration.RemoveObsoletePluginSymlinks(homeDir, binPath))
		_, err := os.Readlink(pluginPath)
		assert.ErrorIs(t, err, os.ErrNotExist)
	})
}
