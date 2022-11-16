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
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path"
	"strings"
	"syscall"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/sirupsen/logrus"
	"golang.org/x/text/encoding/unicode"
)

func KillRancherDesktop() {
	cmd := exec.Command("taskkill", "/IM", "Rancher Desktop", "/T", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: CREATE_NO_WINDOW}
	cmd.Run()
}

func deleteWindowsData(keepSystemImages bool, appName string) error {
	dirs, err := getDirectoriesToDelete(keepSystemImages, appName)
	if err != nil {
		return err
	}
	for _, dir := range dirs {
		logrus.WithField("path", dir).Trace("Removing directory")
		if err := os.RemoveAll(dir); err != nil {
			logrus.Errorf("Problem trying to delete %s: %s\n", dir, err)
		}
	}
	return nil
}

func getDirectoriesToDelete(keepSystemImages bool, appName string) ([]string, error) {
	// Ordered from least important to most, so that if delete fails we
	// still keep some useful data.
	appData, err := directories.GetRoamingAppDataDirectory()
	if err != nil {
		return nil, fmt.Errorf("could not get AppData folder: %w", err)
	}
	localAppData, err := directories.GetLocalAppDataDirectory()
	if err != nil {
		return nil, fmt.Errorf("could not get LocalAppData folder: %w", err)
	}
	dirs := []string{path.Join(localAppData, fmt.Sprintf("%s-updater", appName))}
	localRDAppData := path.Join(localAppData, appName)
	if keepSystemImages {
		// We need to unpack the local appData dir, so we don't delete the main cached downloads
		// Specifically, don't delete .../cache/k3s & k3s-versions.json
		files, err := ioutil.ReadDir(localRDAppData)
		if err != nil {
			return nil, fmt.Errorf("could not get files in folder %s: %w", localRDAppData, err)
		}
		for _, file := range files {
			baseName := file.Name()
			if strings.ToLower(baseName) != "cache" {
				dirs = append(dirs, path.Join(localRDAppData, baseName))
			} else {
				cacheDir := path.Join(localRDAppData, baseName)
				cacheFiles, err := ioutil.ReadDir(cacheDir)
				if err != nil {
					logrus.Infof("could not get files in folder %s: %s", cacheDir, err)
				} else {
					for _, cacheDirFile := range cacheFiles {
						cacheDirFileName := cacheDirFile.Name()
						lcFileName := strings.ToLower(cacheDirFileName)
						if lcFileName != "k3s" && lcFileName != "k3s-versions.json" {
							dirs = append(dirs, path.Join(cacheDir, cacheDirFileName))
						}
					}
				}
			}
		}
	} else {
		dirs = append(dirs, localRDAppData)
	}
	dirs = append(dirs, path.Join(appData, appName))
	return dirs, nil
}

const CREATE_NO_WINDOW = 0x08000000

func unregisterWSL() error {
	cmd := exec.Command("wsl", "--list", "--quiet")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: CREATE_NO_WINDOW}
	rawBytes, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error getting current WSLs: %w", err)
	}
	decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
	actualOutput, err := decoder.String(string(rawBytes))
	if err != nil {
		return fmt.Errorf("error getting current WSLs: %w", err)
	}
	actualOutput = strings.ReplaceAll(actualOutput, "\r", "")
	wsls := strings.Split(actualOutput, "\n")
	wslsToKill := []string{}
	for _, s := range wsls {
		if s == "rancher-desktop" || s == "rancher-desktop-data" {
			wslsToKill = append(wslsToKill, s)
		}
	}

	for _, wsl := range wslsToKill {
		cmd := exec.Command("wsl", "--unregister", wsl)
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: CREATE_NO_WINDOW}
		if err := cmd.Run(); err != nil {
			logrus.Errorf("Error unregistering WSL %s: %s\n", wsl, err)
		}
	}
	return nil
}
