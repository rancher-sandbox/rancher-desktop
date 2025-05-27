//go:build unix

/*
Copyright © 2025 SUSE LLC

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
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	dockerconfig "github.com/docker/cli/cli/config"
	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

// appHomeDirectories() returns the path to the AppHome directory,
// if it can be deleted. There may be some subdirectories inside it
// that need to be preserved across a factory reset, so if any of
// those exist and are non-empty, then a list of all files/directories
// that don't match the exclusion list will be returned instead.
func appHomeDirectories(appPaths *paths.Paths) []string {
	// Use lowercase names for comparison in case the user created the subdirectory manually
	// with the wrong case on a case-preserving filesystem (default on macOS).
	excludeDir := map[string]string{
		strings.ToLower(appPaths.Snapshots):       appPaths.Snapshots,
		strings.ToLower(appPaths.ContainerdShims): appPaths.ContainerdShims,
	}
	haveExclusions := false
	for _, dirname := range excludeDir {
		files, err := os.ReadDir(dirname)
		if err == nil && len(files) > 0 {
			haveExclusions = true
			break
		}
	}
	if !haveExclusions {
		return []string{appPaths.AppHome}
	}
	appHomeFiles, err := os.ReadDir(appPaths.AppHome)
	if err != nil {
		logrus.Errorf("failed to read contents of dir %s: %s", appPaths.AppHome, err)
		return []string{}
	}
	pathList := make([]string, 0, len(appHomeFiles))
	for _, file := range appHomeFiles {
		fullname := strings.ToLower(filepath.Join(appPaths.AppHome, file.Name()))
		if _, ok := excludeDir[fullname]; !ok {
			pathList = append(pathList, fullname)
		}
	}
	return pathList
}

// Most of the errors in this function are reported, but we continue to try to delete things,
// because there isn't really a dependency graph here.
// For example, if we can't delete the Lima VM, that doesn't mean we can't remove docker files
// or pull the path settings out of the shell profile files.
func deleteUnixLikeData(appPaths *paths.Paths, pathList []string) error {
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
	if err := removeDockerCliPlugins(appPaths.AltAppHome); err != nil {
		logrus.Errorf("Error trying to remove docker plugins %s", err)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		// If we can't get home directory, none of the below code is valid
		logrus.Errorf("Error trying to get home dir: %s", err)
		return nil
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
	rawPaths = append(rawPaths, path.Join(homeDir, ".config", "fish", "config.fish"))

	return removePathManagement(rawPaths)
}

func removeDockerCliPlugins(altAppHomePath string) error {
	cliPluginsDir := path.Join(dockerconfig.Dir(), "cli-plugins")
	entries, err := os.ReadDir(cliPluginsDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
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
	const startTarget = `### MANAGED BY RANCHER DESKTOP START \(DO NOT EDIT\)`
	const endTarget = `### MANAGED BY RANCHER DESKTOP END \(DO NOT EDIT\)`

	// bash files etc. break if they contain \r's, so don't worry about them
	ptn := regexp.MustCompile(fmt.Sprintf(`(?ms)^(?P<preMarkerText>.*?)(?P<preMarkerNewlines>\n*)^%s.*?^%s\s*?$(?P<postMarkerNewlines>\n*)(?P<postMarkerText>.*)$`, startTarget, endTarget))

	for _, dotFile := range dotFiles {
		byteContents, err := os.ReadFile(dotFile)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				logrus.Errorf("Error trying to read %s: %s\n", dotFile, err)
			}
			continue
		}
		contents := string(byteContents)
		parts := ptn.FindStringSubmatch(contents)
		if len(parts) == 0 {
			continue
		}

		preMarkerTextIndex := ptn.SubexpIndex("preMarkerText")
		preMarkerNewlineIndex := ptn.SubexpIndex("preMarkerNewlines")
		postMarkerNewlineIndex := ptn.SubexpIndex("postMarkerNewlines")
		postMarkerTextIndex := ptn.SubexpIndex("postMarkerText")
		if parts[preMarkerTextIndex] == "" && parts[postMarkerTextIndex] == "" {
			// Nothing of interest left in this file, so delete it
			err = os.RemoveAll(dotFile)
			if err != nil {
				// but continue processing the other files
				logrus.Errorf("Failed to delete file %s (error %s)\n", dotFile, err)
			}
			continue
		}

		newParts := []string{parts[preMarkerTextIndex]}

		preMarkerNewlines := parts[preMarkerNewlineIndex]
		postMarkerNewlines := parts[postMarkerNewlineIndex]
		if len(preMarkerNewlines) == 1 {
			newParts = append(newParts, preMarkerNewlines)
		} else if len(preMarkerNewlines) > 1 {
			// One of the newlines was inserted by the dotfile manager, but keep the others
			newParts = append(newParts, preMarkerNewlines[1:])
		}
		if parts[postMarkerTextIndex] != "" {
			if len(postMarkerNewlines) > 1 {
				// Either there was a newline before the marker block, and we have copied
				// it into the new file,
				// or the marker block was at the start of the file, in which case we can
				// drop one of the post-marker block newlines
				newParts = append(newParts, postMarkerNewlines[1:])
			}
			newParts = append(newParts, parts[postMarkerTextIndex])
		}
		newContents := strings.Join(newParts, "")
		filestat, err := os.Stat(dotFile)
		if err != nil {
			return fmt.Errorf("error trying to stat %q: %w", dotFile, err)
		}
		if err = os.WriteFile(dotFile, []byte(newContents), filestat.Mode()); err != nil {
			logrus.Errorf("error trying to update %s: %s\n", dotFile, err)
		}
	}
	return nil
}
