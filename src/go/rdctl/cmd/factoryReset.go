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

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"

	dockerconfig "github.com/docker/docker/cli/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

var removeKubernetesCache bool

// Note that this command's only flag is default to not remove k8s cache
// but the server takes an optional flag meaning the opposite (as per issues 1701 and 2408)

var factoryResetCmd = &cobra.Command{
	Use:   "factory-reset",
	Short: "Clear all the Rancher Desktop state and shut it down.",
	Long: `Clear all the Rancher Desktop state and shut it down.
Use the --remove-kubernetes-cache=BOOLEAN flag to also remove the cached Kubernetes images.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		err := cobra.NoArgs(cmd, args)
		if err != nil {
			return err
		}
		cmd.SilenceUsage = true
		if startShutdownProcess() {
			continueShutdown()
		}
		return map[string]func() error{
			"darwin":  deleteDarwinData,
			"linux":   deleteLinuxData,
			"windows": deleteWindowsData,
		}[runtime.GOOS]()
	},
}

func init() {
	rootCmd.AddCommand(factoryResetCmd)
	factoryResetCmd.Flags().BoolVar(&removeKubernetesCache, "remove-kubernetes-cache", false, "If specified, also removes the cached Kubernetes images.")
}

// Assume that if `doShutdown()` doesn't return an error, we started a shutdown process
// that we will need to finish.
func startShutdownProcess() bool {
	_, err := doShutdown()
	if err != nil {
		return false
	}
	// If we need to shut down, give the UI a bit of time before we start deleting directories.
	time.Sleep(5 * time.Second)
	return true
}

func doCheckWithTimeout(checkFunc func() bool, killFunc func()) {
	retryCount := 10
	retryWait := 1
	iter := 1
	for {
		if !checkFunc() {
			return
		}
		iter += 1
		if iter > retryCount {
			killFunc()
			return
		}
		time.Sleep(time.Duration(retryWait) * time.Second)
	}
}

/**
 * checkProcessX functions return true if it detects the app is still running, false otherwise
 */

func checkProcessDarwin() bool {
	return checkProcessLinuxLike("Contents/MacOS/Rancher Desktop")
}

func checkProcessLinux() bool {
	return checkProcessLinuxLike("rancher-desktop")
}

func checkProcessLinuxLike(commandPattern string) bool {
	result, err := exec.Command("pgrep", "-f", commandPattern).CombinedOutput()
	if err != nil {
		return false
	}
	ptn, err := regexp.Compile(`\A[0-9\s]+\z`)
	if err != nil {
		logrus.WithField("error", err).Warn("failed to compile pattern")
		return false
	}
	return ptn.Match(result)
}

func checkProcessWindows() bool {
	_, err := factoryreset.GetLockfilePath("rancher-desktop")
	return err == nil
}

func pkillDarwin() {
	exec.Command("pkill", "-f", "Contents/MacOS/Rancher Desktop").Run()
}

func pkillLinux() {
	exec.Command("pkill", "-f", "rancher-desktop").Run()
}

func powershellKillWindows() {
	exec.Command("powershell", "-Command", `Stop-Process -Name "Rancher Desktop" -ErrorAction "SilentlyContinue"`).Run()
}

func continueShutdown() {
	switch runtime.GOOS {
	case "darwin":
		shutdownQemu()
		doCheckWithTimeout(checkProcessDarwin, pkillDarwin)
	case "linux":
		shutdownQemu()
		doCheckWithTimeout(checkProcessLinux, pkillLinux)
	case "windows":
		doCheckWithTimeout(checkProcessWindows, powershellKillWindows)
	}
}

func shutdownQemu() {
	exec.Command("pkill", "qemu-system").Run()
}

func deleteDarwinData() error {
	libraryPath := path.Join(os.Getenv("HOME"), "Library")
	appHomePath := path.Join(libraryPath, "Application Support", "rancher-desktop")
	altAppHomePath := path.Join(os.Getenv("HOME"), ".rd")
	cachePath := path.Join(libraryPath, "Caches", "rancher-desktop")
	configPath := path.Join(libraryPath, "Preferences", "rancher-desktop")
	updaterPath := path.Join(libraryPath, "Application Support", "Caches", "rancher-desktop-updater")
	logsPath := os.Getenv("RD_LOGS_DIR")
	if logsPath == "" {
		logsPath = path.Join(libraryPath, "Logs", "rancher-desktop")
	}

	pathList := []string{
		appHomePath,
		altAppHomePath,
		configPath,
		logsPath,
		updaterPath,
		path.Join(libraryPath, "Application Support", "Rancher Desktop"),
	}
	if removeKubernetesCache {
		pathList = append(pathList, cachePath)
	}
	return deleteLinuxLikeData(altAppHomePath, path.Join(os.Getenv("HOME"), ".config"), pathList)
}

func deleteLinuxData() error {
	homeDir := os.Getenv("HOME")

	dataHomePath := os.Getenv("XDG_DATA_HOME")
	if dataHomePath == "" {
		dataHomePath = path.Join(homeDir, ".local", "share")
	}
	dataHomePath = path.Join(dataHomePath, "rancher-desktop")

	configHomePath := os.Getenv("XDG_CONFIG_HOME")
	if configHomePath == "" {
		configHomePath = path.Join(homeDir, ".config")
	}
	configPath := path.Join(configHomePath, "rancher-desktop")

	cacheHomePath := os.Getenv("XDG_CACHE_HOME")
	if cacheHomePath == "" {
		cacheHomePath = path.Join(homeDir, ".cache")
	}
	cachePath := path.Join(cacheHomePath, "rancher-desktop")

	altAppHomePath := path.Join(homeDir, ".rd")

	pathList := []string{
		altAppHomePath,
		configPath,
		path.Join(configHomePath, "Rancher Desktop"),
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
	return deleteLinuxLikeData(altAppHomePath, configHomePath, pathList)
}

// XXX: Windows doesn't have symlinks, do we have to clean up any cli-plugins?
func deleteWindowsData() error {
	for _, wsl := range []string{"rancher-desktop-data", "rancher-desktop"} {
		err := exec.Command("wslconfig", "/u", wsl).Run()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error unregistering WSL %s: %s\n", wsl, err)
		}
	}
	err := factoryreset.DeleteWindowsData(!removeKubernetesCache, "rancher-desktop")
	if err != nil {
		return err
	}
	return clearDockerContext()
}

func deleteLinuxLikeData(altAppHomePath string, configHomePath string, pathList []string) error {
	deleteLimaVM()

	for _, currentPath := range pathList {
		err := os.RemoveAll(currentPath)
		if err != nil {
			return fmt.Errorf("Error removing %s: %w", currentPath, err)
		}
	}
	err := clearDockerContext()
	if err != nil {
		return err
	}
	err = removeDockerCliPlugins(altAppHomePath)
	if err != nil {
		return err
	}
	homeDir := os.Getenv("HOME")
	rawPaths := []string{
		".bashrc",
		".bash_profile",
		".bash_login",
		".profile",
		".zshrc",
		".cshrc",
		".tshrc",
	}
	for i, s := range rawPaths {
		rawPaths[i] = path.Join(homeDir, s)
	}
	rawPaths = append(rawPaths, path.Join(configHomePath, "fish", "config.fish"))

	return removePathManagement(rawPaths)
}

func deleteLimaVM() error {
	err := setupLimaHome()
	if err != nil {
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
			continue
		}
		if strings.Contains(target, altAppHomePath) {
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
				// Nothing left to do here, since there is no cli-plugins dir
				continue
			}
			fmt.Fprintf(os.Stderr, "Error trying to read %s: %w\n", dotFile, err)
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
			return fmt.Errorf("Error trying to stat %s: %w", dotFile, err)
		}
		err = os.WriteFile(dotFile, []byte(newContents), filestat.Mode())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error trying to update %s: %w\n", dotFile, err)
		}
	}
	return nil
}

type dockerConfigType map[string]interface{}

func clearDockerContext() error {
	// Ignore failure to delete this next file:
	os.Remove(path.Join(dockerconfig.Dir(), "plaintext-credentials.config.json"))

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
	err = json.Unmarshal(contents, &dockerConfigContents)
	if err != nil {
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
