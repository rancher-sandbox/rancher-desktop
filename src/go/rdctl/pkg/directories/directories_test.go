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

package directories_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
)

func TestGetApplicationDirectory(t *testing.T) {
	t.Parallel()
	platformDirs := map[string][]string{
		"darwin":  {"Contents", "Resources", "resources", "darwin", "bin"},
		"windows": {"resources", "resources", "win32", "bin"},
	}[runtime.GOOS]
	if len(platformDirs) == 0 {
		platformDirs = []string{"resources", "resources", runtime.GOOS, "bin"}
	}
	t.Run("should go up the directory", func(t *testing.T) {
		dir, err := filepath.EvalSymlinks(t.TempDir())
		require.NoError(t, err)
		binDir := filepath.Join(append([]string{dir}, platformDirs...)...)
		require.NoError(t, os.MkdirAll(binDir, 0o755))
		testExe, err := os.Executable()
		require.NoError(t, err)
		exePath := filepath.Join(binDir, filepath.Base(testExe))
		exe, err := os.Create(exePath)
		require.NoError(t, err)
		defer exe.Close()
		ctx := directories.OverrideRdctlPath(context.Background(), exePath)
		actual, err := directories.GetApplicationDirectory(ctx)
		require.NoError(t, err)
		assert.Equal(t, dir, actual)
	})
	t.Run("invalid executable path", func(t *testing.T) {
		ctx := directories.OverrideRdctlPath(context.Background(), "")
		_, err := directories.GetApplicationDirectory(ctx)
		assert.Error(t, err)
	})
	t.Run("nonexistent executable file", func(t *testing.T) {
		dir, err := filepath.EvalSymlinks(t.TempDir())
		require.NoError(t, err)
		exePath := filepath.Join(dir, "does-not-exist")
		ctx := directories.OverrideRdctlPath(context.Background(), exePath)
		_, err = directories.GetApplicationDirectory(ctx)
		assert.Error(t, err)
	})
	t.Run("should resolve symbolic links", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("Test is not supported on Windows")
		}
		dir, err := filepath.EvalSymlinks(t.TempDir())
		require.NoError(t, err)
		binDir := filepath.Join(append([]string{dir}, platformDirs...)...)
		require.NoError(t, os.MkdirAll(binDir, 0o755))
		testExe, err := os.Executable()
		require.NoError(t, err)
		exePath := filepath.Join(binDir, filepath.Base(testExe))
		exe, err := os.Create(exePath)
		require.NoError(t, err)
		defer exe.Close()
		link := filepath.Join(dir, "symbolic-link")
		require.NoError(t, os.Symlink(exePath, link))
		ctx := directories.OverrideRdctlPath(context.Background(), exePath)
		actual, err := directories.GetApplicationDirectory(ctx)
		require.NoError(t, err)
		assert.Equal(t, dir, actual)
	})
	t.Run("symbolic link loop", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("Test is not supported on Windows")
		}
		dir, err := filepath.EvalSymlinks(t.TempDir())
		require.NoError(t, err)
		exePath := filepath.Join(dir, "executable")
		require.NoError(t, os.Symlink(exePath, exePath))
		ctx := directories.OverrideRdctlPath(context.Background(), exePath)
		_, err = directories.GetApplicationDirectory(ctx)
		assert.Error(t, err)
	})
}
