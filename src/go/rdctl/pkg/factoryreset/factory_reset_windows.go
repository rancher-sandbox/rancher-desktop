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
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
)

// CheckProcessWindows - returns true if Rancher Desktop is still running, false if it isn't
// along with an error condition if there's a problem detecting that.
//
// It does this by calling `tasklist`, the Windows answer to ps(1)

func CheckProcessWindows() (bool, error) {
	cmd := exec.Command("tasklist", "/NH", "/FI", "IMAGENAME eq Rancher Desktop.exe", "/FO", "CSV")
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	allOutput, err := cmd.CombinedOutput()
	if err != nil {
		return false, fmt.Errorf("failed to run %q: %w", cmd, err)
	}
	r := csv.NewReader(bytes.NewReader(allOutput))
	for {
		record, err := r.Read()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				return false, fmt.Errorf("failed to csv-read the output for tasklist: %w", err)
			}
			break
		}
		if len(record) > 0 && record[0] == "Rancher Desktop.exe" {
			return true, nil
		}
	}
	return false, nil
}

// KillRancherDesktop terminates all processes where the executable is from the
// Rancher Desktop application, excluding the current process.
func KillRancherDesktop(ctx context.Context) error {
	appDir, err := directories.GetApplicationDirectory(ctx)
	if err != nil {
		return fmt.Errorf("could not find application directory: %w", err)
	}

	err = process.TerminateProcessInDirectory(appDir, true)
	if err != nil {
		return err
	}

	return nil
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
	localAppData, err := directories.GetLocalAppDataDirectory()
	if err != nil {
		return nil, fmt.Errorf("could not get LocalAppData folder: %w", err)
	}
	dirs := []string{filepath.Join(localAppData, fmt.Sprintf("%s-updater", appName))}
	localRDAppData := filepath.Join(localAppData, appName)

	// add files in %LOCALAPPDATA%\rancher-desktop
	deleteLocalRDAppData := true
	appDataFiles, err := os.ReadDir(localRDAppData)
	if errors.Is(err, os.ErrNotExist) {
		return dirs, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to read directory %q: %w", localRDAppData, err)
	}
	for _, appDataFile := range appDataFiles {
		fileName := appDataFile.Name()
		if fileName == "snapshots" {
			// Only delete snapshots directory if it is empty
			snapshotsDir := filepath.Join(localRDAppData, fileName)
			snapshotsDirContents, err := os.ReadDir(snapshotsDir)
			if errors.Is(err, os.ErrNotExist) {
				continue
			} else if err != nil {
				return nil, fmt.Errorf("failed to read directory %q: %w", snapshotsDir, err)
			}
			if len(snapshotsDirContents) == 0 {
				dirs = append(dirs, snapshotsDir)
			} else {
				deleteLocalRDAppData = false
			}
		} else if fileName == "containerd-shims" {
			// Only delete containerd-shims directory if it is empty
			shimsDir := filepath.Join(localRDAppData, fileName)
			shimsDirContents, err := os.ReadDir(shimsDir)
			if errors.Is(err, os.ErrNotExist) {
				continue
			} else if err != nil {
				return nil, fmt.Errorf("failed to read directory %q: %w", shimsDir, err)
			}
			if len(shimsDirContents) == 0 {
				dirs = append(dirs, shimsDir)
			} else {
				deleteLocalRDAppData = false
			}
		} else if fileName == "cache" && keepSystemImages {
			// Don't delete cache\k3s & cache\k3s-versions.json if keeping system images
			cacheDir := filepath.Join(localRDAppData, fileName)
			cacheDirFiles, err := os.ReadDir(cacheDir)
			if errors.Is(err, os.ErrNotExist) {
				continue
			} else if err != nil {
				return nil, fmt.Errorf("failed to read directory %q: %w", cacheDir, err)
			}
			for _, cacheDirFile := range cacheDirFiles {
				cacheFileName := cacheDirFile.Name()
				if cacheFileName != "k3s" && cacheFileName != "k3s-versions.json" {
					dirs = append(dirs, filepath.Join(cacheDir, cacheFileName))
				}
			}
			deleteLocalRDAppData = false
		} else {
			dirs = append(dirs, filepath.Join(localRDAppData, fileName))
		}
	}
	if deleteLocalRDAppData {
		dirs = append(dirs, localRDAppData)
	}
	roamingAppData, err := directories.GetRoamingAppDataDirectory()
	if err == nil {
		dirs = append(dirs,
			filepath.Join(roamingAppData, appName),
			// Electron stores some files in AppData\Roaming\Rancher Desktop
			filepath.Join(roamingAppData, "Rancher Desktop"))
	} else {
		logrus.Errorf("Could not get AppData (roaming) folder: %s\n", err)
	}
	// The OldUserData directory is already deleted by deleting the Cache directory.
	return dirs, nil
}
