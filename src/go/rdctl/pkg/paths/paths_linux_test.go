package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetPaths(t *testing.T) {
	t.Run("should return correct paths without environment variables set", func(t *testing.T) {
		// Ensure that these variables are not set in the testing environment
		environment := map[string]string{
			"RD_LOGS_DIR":     "",
			"XDG_DATA_HOME":   "",
			"XDG_CONFIG_HOME": "",
			"XDG_CACHE_HOME":  "",
		}
		for key, value := range environment {
			t.Setenv(key, value)
		}

		homeDir, err := os.UserHomeDir()
		if err != nil {
			t.Errorf("Unexpected error getting user home directory: %s", err)
		}
		expectedPaths := Paths{
			AppHome:                 filepath.Join(homeDir, ".config", appName),
			AltAppHome:              filepath.Join(homeDir, ".rd"),
			Config:                  filepath.Join(homeDir, ".config", appName),
			Logs:                    filepath.Join(homeDir, ".local/share", appName, "logs"),
			Cache:                   filepath.Join(homeDir, ".cache", appName),
			Lima:                    filepath.Join(homeDir, ".local/share", appName, "lima"),
			Integration:             filepath.Join(homeDir, ".rd/bin"),
			Resources:               fakeResourcesPath,
			DeploymentProfileSystem: filepath.Join("/etc", appName),
			DeploymentProfileUser:   filepath.Join(homeDir, ".config"),
			ExtensionRoot:           filepath.Join(homeDir, ".local/share", appName, "extensions"),
		}
		actualPaths, err := GetPaths(mockGetResourcesPath)
		if err != nil {
			t.Errorf("Unexpected error getting actual paths: %s", err)
		}
		if actualPaths != expectedPaths {
			t.Errorf("Actual paths does not match expected paths\nActual paths: %#v\nExpected paths: %#v", actualPaths, expectedPaths)
		}
	})

	t.Run("should return correct paths with environment variables set", func(t *testing.T) {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			t.Errorf("Unexpected error getting user home directory: %s", err)
		}
		environment := map[string]string{
			"RD_LOGS_DIR":     filepath.Join(homeDir, "anotherLogsDir"),
			"XDG_DATA_HOME":   filepath.Join(homeDir, "anotherDataHome"),
			"XDG_CONFIG_HOME": filepath.Join(homeDir, "anotherConfigHome"),
			"XDG_CACHE_HOME":  filepath.Join(homeDir, "anotherCacheHome"),
		}
		for key, value := range environment {
			t.Setenv(key, value)
		}

		expectedPaths := Paths{
			AppHome:                 filepath.Join(environment["XDG_CONFIG_HOME"], appName),
			AltAppHome:              filepath.Join(homeDir, ".rd"),
			Config:                  filepath.Join(environment["XDG_CONFIG_HOME"], appName),
			Logs:                    environment["RD_LOGS_DIR"],
			Cache:                   filepath.Join(environment["XDG_CACHE_HOME"], appName),
			Lima:                    filepath.Join(environment["XDG_DATA_HOME"], appName, "lima"),
			Integration:             filepath.Join(homeDir, ".rd/bin"),
			Resources:               fakeResourcesPath,
			DeploymentProfileSystem: filepath.Join("/etc", appName),
			DeploymentProfileUser:   environment["XDG_CONFIG_HOME"],
			ExtensionRoot:           filepath.Join(environment["XDG_DATA_HOME"], appName, "extensions"),
		}
		actualPaths, err := GetPaths(mockGetResourcesPath)
		if err != nil {
			t.Errorf("Unexpected error getting actual paths: %s", err)
		}
		if actualPaths != expectedPaths {
			t.Errorf("Actual paths does not match expected paths\nActual paths: %#v\nExpected paths: %#v", actualPaths, expectedPaths)
		}
	})
}
