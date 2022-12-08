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
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"unsafe"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
	"golang.org/x/text/encoding/unicode"
)

var (
	pKernel32      = windows.NewLazySystemDLL("kernel32.dll")
	pEnumProcesses = pKernel32.NewProc("K32EnumProcesses")
)

// CheckProcessWindows - returns true if Rancher Desktop is still running, false if it isn't
// along with an error condition if there's a problem detecting that.
//
// It does this by calling `tasklist`, the Windows answer to ps(1)

func CheckProcessWindows() (bool, error) {
	cmd := exec.Command("tasklist", "/NH", "/FI", "IMAGENAME eq Rancher Desktop.exe", "/FO", "CSV")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: CREATE_NO_WINDOW}
	allOutput, err := cmd.CombinedOutput()
	if err != nil {
		return false, fmt.Errorf("Failed to run %q: %w", cmd, err)
	}
	r := csv.NewReader(bytes.NewReader(allOutput))
	for {
		record, err := r.Read()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				return false, fmt.Errorf("Failed to csv-read the output for tasklist: %w", err)
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
func KillRancherDesktop() error {

	err := stopPrivilegedService()
	if err != nil {
		return fmt.Errorf("failed to stop privileged service: %w", err)
	}

	appDir, err := directories.GetApplicationDirectory()
	if err != nil {
		return fmt.Errorf("could not find application directory: %w", err)
	}

	var processes []uint32
	err = directories.InvokeWin32WithBuffer(func(size int) error {
		processes = make([]uint32, size)
		var bytesReturned uint32
		// We can't use `windows.EnumProcesses`, because it passes in an incorrect
		// value for the second argument (`cb`).
		elementSize := unsafe.Sizeof(uint32(0))
		bufferSize := uintptr(len(processes)) * elementSize
		n, _, err := pEnumProcesses.Call(
			uintptr(unsafe.Pointer(&processes[0])),
			bufferSize,
			uintptr(unsafe.Pointer(&bytesReturned)),
		)
		if n == 0 {
			return err
		}
		if uintptr(bytesReturned) >= bufferSize {
			return windows.ERROR_INSUFFICIENT_BUFFER
		}
		processesFound := uintptr(bytesReturned) / elementSize
		logrus.Tracef("got %d processes", processesFound)
		processes = processes[:processesFound]
		return nil
	})
	if err != nil {
		return fmt.Errorf("could not get process list: %w", err)
	}

	sort.Slice(processes, func(i, j int) bool {
		return processes[i] < processes[j]
	})
	var processesToKill []uint32
	for _, pid := range processes {
		// Add a scope to help with defer
		(func(pid uint32) {
			if pid == uint32(os.Getpid()) {
				// Skip the current process.
				return
			}

			hProc, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
			if err != nil {
				// We can't open privileged processes, processes that have exited since,
				// idle process, etc.; so we log this at trace level instead.
				logrus.Tracef("failed to open pid %d: %s (skipping)", pid, err)
				return
			}
			defer windows.CloseHandle(hProc)

			var imageName string
			err = directories.InvokeWin32WithBuffer(func(size int) error {
				nameBuf := make([]uint16, size)
				charsWritten := uint32(size)
				err := windows.QueryFullProcessImageName(hProc, 0, &nameBuf[0], &charsWritten)
				if err != nil {
					logrus.Tracef("failed to get image name for pid %d: %s", pid, err)
					return err
				}
				if charsWritten >= uint32(size)-1 {
					logrus.Tracef("buffer too small for pid %d image name", pid)
					return windows.ERROR_INSUFFICIENT_BUFFER
				}
				imageName = windows.UTF16ToString(nameBuf)
				return nil
			})
			if err != nil {
				logrus.Debugf("failed to get process name of pid %d: %w (skipping)", pid, err)
				return
			}

			relPath, err := filepath.Rel(appDir, imageName)
			if err != nil {
				// This may be because they're on different drives, network shares, etc.
				logrus.Tracef("failed to make pid %d image %s relative to %s: %s", pid, imageName, appDir, err)
				return
			}
			if strings.HasPrefix(relPath, "..") {
				// Relative path includes "../" prefix, not a child of appDir
				logrus.Tracef("skipping pid %d (%s), not in app %s", pid, imageName, appDir)
				return
			}

			logrus.Tracef("will terminate pid %d image %s", pid, imageName)
			processesToKill = append(processesToKill, pid)
		})(pid)
	}

	for _, pid := range processesToKill {
		(func() {
			hProc, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, pid)
			if err != nil {
				logrus.Infof("failed to open process %d for termination, skipping", pid)
				return
			}
			defer windows.CloseHandle(hProc)

			if err = windows.TerminateProcess(hProc, 0); err != nil {
				logrus.Infof("failed to terminate process %d: %s", pid, err)
			}
		})()
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
