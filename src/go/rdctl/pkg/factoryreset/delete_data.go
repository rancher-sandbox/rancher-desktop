/*
Copyright © 2022 SUSE LLC

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

package factoryreset

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	dockerconfig "github.com/docker/docker/cli/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/sirupsen/logrus"
)

func DeleteData(removeKubernetesCache bool) error {
	return map[string]func(bool) error{
		"darwin":  deleteDarwinData,
		"linux":   deleteLinuxData,
		"windows": unregisterAndDeleteWindowsData,
	}[runtime.GOOS](removeKubernetesCache)
}

func getStandardDirs() (string, string, string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", "", "", err
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", "", "", err
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", "", "", err
	}
	return configDir, cacheDir, homeDir, nil
}

func deleteDarwinData(removeKubernetesCache bool) error {
	configDir, cacheDir, homeDir, err := getStandardDirs()
	if err != nil {
		return err
	}
	libraryPath := path.Join(homeDir, "Library")

	altAppHomePath := path.Join(homeDir, ".rd")
	appHomePath := path.Join(configDir, "rancher-desktop")
	cachePath := path.Join(cacheDir, "rancher-desktop")
	logsPath := os.Getenv("RD_LOGS_DIR")
	if logsPath == "" {
		logsPath = path.Join(libraryPath, "Logs", "rancher-desktop")
	}
	settingsPath := path.Join(libraryPath, "Preferences", "rancher-desktop")
	updaterPath := path.Join(configDir, "Caches", "rancher-desktop-updater")

	pathList := []string{
		altAppHomePath,
		appHomePath,
		logsPath,
		settingsPath,
		updaterPath,
	}
	if removeKubernetesCache {
		pathList = append(pathList, cachePath)
	}
	return deleteUnixLikeData(homeDir, altAppHomePath, path.Join(homeDir, ".config"), pathList)
}

func deleteLinuxData(removeKubernetesCache bool) error {
	configHomePath, cacheHomePath, homeDir, err := getStandardDirs()
	if err != nil {
		return err
	}

	dataDir := os.Getenv("XDG_DATA_HOME")
	if dataDir == "" {
		dataDir = path.Join(homeDir, ".local", "share")
	}
	altAppHomePath := path.Join(homeDir, ".rd")
	cachePath := path.Join(cacheHomePath, "rancher-desktop")
	configPath := path.Join(configHomePath, "rancher-desktop")
	electronConfigPath := path.Join(configHomePath, "Rancher Desktop")
	dataHomePath := path.Join(dataDir, "rancher-desktop")

	pathList := []string{
		altAppHomePath,
		configPath,
		electronConfigPath,
		path.Join(homeDir, ".local", "state", "rancher-desktop"),
	}
	logsPath := os.Getenv("RD_LOGS_DIR")
	if logsPath != "" {
		pathList = append(pathList, logsPath, path.Join(dataHomePath, "lima"))
	} else {
		pathList = append(pathList, path.Join(dataHomePath))
	}
	if removeKubernetesCache {
		pathList = append(pathList, cachePath)
	}
	return deleteUnixLikeData(homeDir, altAppHomePath, configHomePath, pathList)
}

func unregisterAndDeleteWindowsData(removeKubernetesCache bool) error {
	if err := unregisterWSL(); err != nil {
		logrus.Errorf("could not unregister WSL: %s", err)
		return err
	}
	if err := deleteWindowsData(!removeKubernetesCache, "rancher-desktop"); err != nil {
		logrus.Errorf("could not delete data: %s", err)
		return err
	}
	if err := clearDockerContext(); err != nil {
		logrus.Errorf("could not clear docker context: %s", err)
		return err
	}
	logrus.Infoln("successfully cleared data.")
	return nil
}

// Most of the errors in this function are reported, but we continue to try to delete things,
// because there isn't really a dependency graph here.
// For example, if we can't delete the Lima VM, that doesn't mean we can't remove docker files
// or pull the path settings out of the shell profile files.
func deleteUnixLikeData(homeDir string, altAppHomePath string, configHomePath string, pathList []string) error {
	if err := deleteLimaVM(); err != nil {
		logrus.Errorf("Error trying to delete the Lima VM: %s\n", err)
	}
	for _, currentPath := range pathList {
		if err := os.RemoveAll(currentPath); err != nil {
			logrus.Errorf("Error trying to remove %s: %s", currentPath, err)
		}
	}
	if err := clearDockerContext(); err != nil {
		logrus.Errorf("Error trying to clear the docker context %s", err)
	}
	if err := removeDockerCliPlugins(altAppHomePath); err != nil {
		logrus.Errorf("Error trying to remove docker plugins %s", err)
	}
	rawPaths := []string{
		".bashrc",
		".bash_profile",
		".bash_login",
		".profile",
		".zshrc",
		".cshrc",
		".tcshrc",
	}
	for i, s := range rawPaths {
		rawPaths[i] = path.Join(homeDir, s)
	}
	rawPaths = append(rawPaths, path.Join(configHomePath, "fish", "config.fish"))

	return removePathManagement(rawPaths)
}

func deleteLimaVM() error {
	if err := directories.SetupLimaHome(); err != nil {
		return err
	}
	execPath, err := os.Executable()
	if err != nil {
		return err
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return err
	}
	limactl := path.Join(path.Dir(path.Dir(execPath)), "lima", "bin", "limactl")
	return exec.Command(limactl, "delete", "-f", "0").Run()
}

func removeDockerCliPlugins(altAppHomePath string) error {
	cliPluginsDir := path.Join(dockerconfig.Dir(), "cli-plugins")
	entries, err := os.ReadDir(cliPluginsDir)
	if err != nil {
		if errors.Is(err, syscall.ENOENT) {
			// Nothing left to do here, since there is no cli-plugins dir
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != os.ModeSymlink {
			continue
		}
		fullPathName := path.Join(cliPluginsDir, entry.Name())
		target, err := os.Readlink(fullPathName)
		if err != nil {
			logrus.Errorf("Failed to follow the symbolic link for file %s: error: %s\n", fullPathName, err)
			continue
		}
		if strings.HasPrefix(target, path.Join(altAppHomePath, "bin")+"/") {
			os.Remove(fullPathName)
		}
	}
	return nil
}

func removePathManagement(dotFiles []string) error {
	for _, dotFile := range dotFiles {
		byteContents, err := os.ReadFile(dotFile)
		if err != nil {
			if errors.Is(err, syscall.ENOENT) {
				// Nothing left to do here, since the dotfile doesn't exist.
				continue
			}
			logrus.Errorf("Error trying to read %s: %s\n", dotFile, err)
			continue
		}
		contents := string(byteContents)
		startTarget := "### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)"
		endTarget := "### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)"
		startPoint := strings.LastIndex(contents, startTarget)
		if startPoint == -1 {
			continue
		}
		relativeEndPoint := strings.Index(contents[startPoint:], endTarget)
		if relativeEndPoint == -1 {
			continue
		}
		newEndPoint := startPoint + relativeEndPoint + len(endTarget)
		if len(contents) > newEndPoint && contents[newEndPoint] == '\n' {
			newEndPoint += 1
		}
		newContents := contents[0:startPoint] + contents[newEndPoint:]
		filestat, err := os.Stat(dotFile)
		if err != nil {
			return fmt.Errorf("error trying to stat %s: %w", dotFile, err)
		}
		if err = os.WriteFile(dotFile, []byte(newContents), filestat.Mode()); err != nil {
			logrus.Errorf("error trying to update %s: %s\n", dotFile, err)
		}
	}
	return nil
}

type dockerConfigType map[string]interface{}

type PartialMeta struct {
	Metadata struct {
		Description string
	}
}

/**
 * cleanupDockerContextFiles - normally RD will remove any contexts from .docker/contexts/meta that it owns.
 * This function checks the dir for any contexts that were left behind, and deletes them.
 */
func cleanupDockerContextFiles() {
	os.RemoveAll(path.Join(dockerconfig.Dir(), "contexts", "meta", "b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8"))
}

func clearDockerContext() error {
	// Ignore failure to delete this next file:
	os.Remove(path.Join(dockerconfig.Dir(), "plaintext-credentials.config.json"))

	cleanupDockerContextFiles()

	configFilePath := path.Join(dockerconfig.Dir(), "config.json")
	dockerConfigContents := make(dockerConfigType)
	contents, err := os.ReadFile(configFilePath)
	if err != nil {
		if errors.Is(err, syscall.ENOENT) {
			// Nothing left to do here, since the file doesn't exist
			return nil
		}
		return fmt.Errorf("factory-reset: error trying to read docker config.json: %w", err)
	}
	if err = json.Unmarshal(contents, &dockerConfigContents); err != nil {
		// If we can't json-unmarshal ~/.docker/config, nothing left to do
		return nil
	}
	currentContextName, ok := dockerConfigContents["currentContext"]
	if !ok {
		return nil
	}
	if currentContextName != "rancher-desktop" {
		return nil
	}
	delete(dockerConfigContents, "currentContext")
	contents, err = json.MarshalIndent(dockerConfigContents, "", "  ")
	if err != nil {
		return err
	}
	scratchFile, err := os.CreateTemp(dockerconfig.Dir(), "tmpconfig.json")
	if err != nil {
		return err
	}
	err = os.WriteFile(scratchFile.Name(), contents, 0600)
	scratchFile.Close()
	if err != nil {
		return err
	}
	return os.Rename(scratchFile.Name(), configFilePath)
}
