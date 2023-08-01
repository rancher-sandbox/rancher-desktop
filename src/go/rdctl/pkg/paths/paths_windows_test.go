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
			"RD_LOGS_DIR":  "",
			"LOCALAPPDATA": "",
			"APPDATA":      "",
		}
		for key, value := range environment {
			t.Setenv(key, value)
		}

		homeDir, err := os.UserHomeDir()
		if err != nil {
			t.Errorf("Unexpected error getting user home directory: %s", err)
		}
		expectedPaths := Paths{
			AppHome:       filepath.Join(homeDir, "AppData", "Roaming", appName),
			AltAppHome:    filepath.Join(homeDir, "AppData", "Roaming", appName),
			Config:        filepath.Join(homeDir, "AppData", "Roaming", appName),
			Logs:          filepath.Join(homeDir, "AppData", "Local", appName, "logs"),
			Cache:         filepath.Join(homeDir, "AppData", "Local", appName, "cache"),
			WslDistro:     filepath.Join(homeDir, "AppData", "Local", appName, "distro"),
			WslDistroData: filepath.Join(homeDir, "AppData", "Local", appName, "distro-data"),
			Resources:     fakeResourcesPath,
			ExtensionRoot: filepath.Join(homeDir, "AppData", "Local", appName, "extensions"),
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
			"RD_LOGS_DIR":  filepath.Join(homeDir, "mockRdLogsDir"),
			"LOCALAPPDATA": filepath.Join(homeDir, "mockLocalAppData"),
			"APPDATA":      filepath.Join(homeDir, "mockAppData"),
		}
		for key, value := range environment {
			t.Setenv(key, value)
		}

		expectedPaths := Paths{
			AppHome:       filepath.Join(environment["APPDATA"], appName),
			AltAppHome:    filepath.Join(environment["APPDATA"], appName),
			Config:        filepath.Join(environment["APPDATA"], appName),
			Logs:          environment["RD_LOGS_DIR"],
			Cache:         filepath.Join(environment["LOCALAPPDATA"], appName, "cache"),
			WslDistro:     filepath.Join(environment["LOCALAPPDATA"], appName, "distro"),
			WslDistroData: filepath.Join(environment["LOCALAPPDATA"], appName, "distro-data"),
			Resources:     fakeResourcesPath,
			ExtensionRoot: filepath.Join(environment["LOCALAPPDATA"], appName, "extensions"),
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
