package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeFileInfo struct {
	mode os.FileMode
}

func (info fakeFileInfo) Name() string       { return "wslpath" }
func (info fakeFileInfo) Size() int64        { return 0 }
func (info fakeFileInfo) Mode() os.FileMode  { return info.mode }
func (info fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (info fakeFileInfo) IsDir() bool        { return info.mode.IsDir() }
func (info fakeFileInfo) Sys() any           { return nil }

func saveWSLEnvs(t *testing.T) {
	originalEnvs := map[string]string{}
	for _, envName := range wslDistroEnvs {
		if value, ok := os.LookupEnv(envName); ok {
			originalEnvs[envName] = value
		}
	}
	t.Cleanup(func() {
		for _, envName := range wslDistroEnvs {
			if value, present := originalEnvs[envName]; present {
				os.Setenv(envName, value)
			} else {
				os.Unsetenv(envName)
			}
		}
	})
}

func TestGetConnectionInfo_ValidConfigFile(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "rd-engine.json")

	config := ConnectionInfo{
		User:     "example_user",
		Password: "example_password",
		Host:     "192.168.1.1",
		Port:     8080,
	}

	data, err := json.Marshal(config)
	require.NoError(t, err)
	err = os.WriteFile(configFile, data, 0600)
	require.NoError(t, err)

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
	})

	configPath = configFile
	DefaultConfigPath = configFile

	result, err := GetConnectionInfo(false)
	require.NoError(t, err)
	assert.Equal(t, "example_user", result.User)
	assert.Equal(t, "example_password", result.Password)
	assert.Equal(t, "192.168.1.1", result.Host)
	assert.Equal(t, 8080, result.Port)
}

func TestGetConnectionInfo_MissingConfigFile_MayBeMissing(t *testing.T) {
	tmpDir := t.TempDir()
	nonExistentFile := filepath.Join(tmpDir, "nonexistent.json")

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
	})

	configPath = ""
	DefaultConfigPath = nonExistentFile

	result, err := GetConnectionInfo(true)
	assert.Nil(t, result)
	assert.Nil(t, err)
}

func TestGetConnectionInfo_MissingConfigFile_Required(t *testing.T) {
	tmpDir := t.TempDir()
	nonExistentFile := filepath.Join(tmpDir, "nonexistent.json")

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
	})

	configPath = nonExistentFile
	DefaultConfigPath = nonExistentFile

	result, err := GetConnectionInfo(false)
	assert.Nil(t, result)
	assert.Error(t, err)
}

func TestGetConnectionInfo_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "rd-engine.json")

	err := os.WriteFile(configFile, []byte("not valid json"), 0600)
	require.NoError(t, err)

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
	})

	configPath = configFile
	DefaultConfigPath = configFile

	result, err := GetConnectionInfo(false)
	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "error parsing config file")
}

func TestGetConnectionInfo_CLIOverrides(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "rd-engine.json")

	config := ConnectionInfo{
		User:     "config_user",
		Password: "config_password",
		Host:     "config_host",
		Port:     9999,
	}

	data, err := json.Marshal(config)
	require.NoError(t, err)
	err = os.WriteFile(configFile, data, 0600)
	require.NoError(t, err)

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	originalConnectionSettings := connectionSettings
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
		connectionSettings = originalConnectionSettings
	})

	configPath = configFile
	DefaultConfigPath = configFile
	connectionSettings = ConnectionInfo{
		User:     "override_user",
		Password: "override_password",
		Host:     "override_host",
		Port:     1234,
	}

	result, err := GetConnectionInfo(false)
	require.NoError(t, err)
	assert.Equal(t, "override_user", result.User)
	assert.Equal(t, "override_password", result.Password)
	assert.Equal(t, "override_host", result.Host)
	assert.Equal(t, 1234, result.Port)
}

func TestGetConnectionInfo_DefaultHost(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "rd-engine.json")

	config := ConnectionInfo{
		User:     "example_user",
		Password: "example_password",
		Port:     8080,
	}

	data, err := json.Marshal(config)
	require.NoError(t, err)
	err = os.WriteFile(configFile, data, 0600)
	require.NoError(t, err)

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	originalConnectionSettings := connectionSettings
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
		connectionSettings = originalConnectionSettings
	})

	configPath = configFile
	DefaultConfigPath = configFile
	connectionSettings = ConnectionInfo{}

	result, err := GetConnectionInfo(false)
	require.NoError(t, err)
	assert.Equal(t, "127.0.0.1", result.Host)
}

func TestGetConnectionInfo_MissingRequiredFields(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "rd-engine.json")

	config := ConnectionInfo{
		Host: "example_host",
	}

	data, err := json.Marshal(config)
	require.NoError(t, err)
	err = os.WriteFile(configFile, data, 0600)
	require.NoError(t, err)

	originalConfigPath := configPath
	originalDefaultConfigPath := DefaultConfigPath
	originalConnectionSettings := connectionSettings
	t.Cleanup(func() {
		configPath = originalConfigPath
		DefaultConfigPath = originalDefaultConfigPath
		connectionSettings = originalConnectionSettings
	})

	configPath = configFile
	DefaultConfigPath = configFile
	connectionSettings = ConnectionInfo{}

	result, err := GetConnectionInfo(false)
	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "insufficient connection settings")
}

func TestIsWSLDistro(t *testing.T) {
	for _, symlinkMode := range []os.FileMode{os.ModeSymlink, 0} {
		symlinkText := map[os.FileMode]string{
			os.ModeSymlink: "with wslpath symlink",
			0:              "without wslpath symlink",
		}[symlinkMode]
		for _, hasEnvs := range []bool{true, false} {
			envText := map[bool]string{
				true:  "with WSL envs",
				false: "without WSL envs",
			}[hasEnvs]
			expected := symlinkMode != 0 && hasEnvs
			testName := fmt.Sprintf("returns %t %s %s", expected, symlinkText, envText)
			t.Run(testName, func(t *testing.T) {
				saveWSLEnvs(t)
				for _, envName := range wslDistroEnvs {
					os.Unsetenv(envName)
				}
				originalLstat := lstatFunc
				t.Cleanup(func() { lstatFunc = originalLstat })
				lstatFunc = func(_ string) (os.FileInfo, error) {
					return fakeFileInfo{mode: symlinkMode}, nil
				}
				if hasEnvs {
					os.Setenv(wslDistroEnvs[0], "Ubuntu")
				}
				if expected {
					assert.True(t, isWSLDistro(), "expected isWSLDistro to be true")
				} else {
					assert.False(t, isWSLDistro(), "expected isWSLDistro to be false")
				}
			})
		}
	}
}

func TestHasWSLEnvs(t *testing.T) {
	t.Run("returns false when none set", func(t *testing.T) {
		saveWSLEnvs(t)
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		assert.False(t, hasWSLEnvs(), "expected hasWSLEnvs to be false without WSL envs")
	})

	t.Run("returns true when any set", func(t *testing.T) {
		saveWSLEnvs(t)
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		os.Setenv(wslDistroEnvs[0], "Ubuntu")
		assert.True(t, hasWSLEnvs(), "expected hasWSLEnvs to be true with WSL envs")
	})
}

func TestIsWSLDistroLstatError(t *testing.T) {
	saveWSLEnvs(t)
	originalLstat := lstatFunc
	t.Cleanup(func() { lstatFunc = originalLstat })
	lstatFunc = func(_ string) (os.FileInfo, error) {
		return nil, errors.New("lstat failed")
	}
	os.Setenv(wslDistroEnvs[0], "Ubuntu")
	assert.False(t, isWSLDistro(), "expected isWSLDistro to be false when lstat fails")
}
