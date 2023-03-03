package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetPaths(t *testing.T) {
	t.Run("should return correct paths without environment variables set", func(t *testing.T) {
		t.Setenv("RD_LOGS_DIR", "")
		homeDir, err := os.UserHomeDir()
		if err != nil {
			t.Errorf("Unexpected error getting user home directory: %s", err)
		}
		expectedPaths := Paths{
			AppHome:                 filepath.Join(homeDir, "Library", "Application Support", appName),
			AltAppHome:              filepath.Join(homeDir, ".rd"),
			Config:                  filepath.Join(homeDir, "Library", "Preferences", appName),
			Logs:                    filepath.Join(homeDir, "Library", "Logs", appName),
			Cache:                   filepath.Join(homeDir, "Library", "Caches", appName),
			Lima:                    filepath.Join(homeDir, "Library", "Application Support", appName, "lima"),
			Integration:             filepath.Join(homeDir, ".rd", "bin"),
			OldIntegration:          "/usr/local/bin",
			Resources:               fakeResourcesPath,
			DeploymentProfileSystem: filepath.Join("/Library", "Preferences", appName),
			DeploymentProfileUser:   filepath.Join(homeDir, "Library", "Preferences", appName),
			ExtensionRoot:           filepath.Join(homeDir, "Library", "Application Support", appName, "extensions"),
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
		rdLogsDir := filepath.Join(homeDir, "anotherLogsDir")
		t.Setenv("RD_LOGS_DIR", rdLogsDir)
		expectedPaths := Paths{
			AppHome:                 filepath.Join(homeDir, "Library", "Application Support", appName),
			AltAppHome:              filepath.Join(homeDir, ".rd"),
			Config:                  filepath.Join(homeDir, "Library", "Preferences", appName),
			Logs:                    rdLogsDir,
			Cache:                   filepath.Join(homeDir, "Library", "Caches", appName),
			Lima:                    filepath.Join(homeDir, "Library", "Application Support", appName, "lima"),
			Integration:             filepath.Join(homeDir, ".rd", "bin"),
			OldIntegration:          "/usr/local/bin",
			Resources:               fakeResourcesPath,
			DeploymentProfileSystem: filepath.Join("/Library", "Preferences", appName),
			DeploymentProfileUser:   filepath.Join(homeDir, "Library", "Preferences", appName),
			ExtensionRoot:           filepath.Join(homeDir, "Library", "Application Support", appName, "extensions"),
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
