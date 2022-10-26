//go:build windows

package factoryreset

import (
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"path"
	"strings"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

func DeleteWindowsData(keepSystemImages bool, appName string) error {
	dirs, err := getDirectoriesToDelete(keepSystemImages, appName)
	if err != nil {
		return err
	}
	for _, dir := range dirs {
		logrus.WithField("path", dir).Trace("Removing directory")
		err := os.RemoveAll(dir)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(os.Stderr, "Problem trying to delete %s: %s\n", dir, err)
		}
	}
	return nil
}

func getDirectoriesToDelete(keepSystemImages bool, appName string) ([]string, error) {
	// Ordered from least important to most, so that if delete fails we
	// still keep some of the useful data.
	appData, err := getKnownFolder(windows.FOLDERID_RoamingAppData)
	if err != nil {
		return nil, fmt.Errorf("could not get AppData folder: %w", err)
	}
	localAppData, err := getKnownFolder(windows.FOLDERID_LocalAppData)
	if err != nil {
		return nil, fmt.Errorf("could not get LocalAppData folder: %w", err)
	}
	dirs := []string{path.Join(localAppData, fmt.Sprintf("%s-updater", appName))}
	localRDAppData := path.Join(localAppData, appName)
	if keepSystemImages {
		// We need to unpack the local appData dir so we don't delete the main cached downloads
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

func GetLockfilePath(appName string) (string, error) {
	appData, err := getKnownFolder(windows.FOLDERID_RoamingAppData)
	if err != nil {
		return "", fmt.Errorf("could not get AppData folder: %w", err)
	}
	return path.Join(appData, appName, "lockfile"), nil
}

var (
	ole32Dll   = windows.MustLoadDLL("Ole32.dll")
	shell32Dll = windows.MustLoadDLL("Shell32.dll")
)

// getKnownFolder gets a Windows known folder.  See https://git.io/JMpgD
func getKnownFolder(folder *windows.KNOWNFOLDERID) (string, error) {
	SHGetKnownFolderPath, err := shell32Dll.FindProc("SHGetKnownFolderPath")
	if err != nil {
		return "", fmt.Errorf("could not find SHGetKnownFolderPath: %w", err)
	}
	CoTaskMemFree, err := ole32Dll.FindProc("CoTaskMemFree")
	if err != nil {
		return "", fmt.Errorf("could not find CoTaskMemFree: %w", err)
	}
	var result uintptr
	hr, _, _ := SHGetKnownFolderPath.Call(
		uintptr(unsafe.Pointer(folder)),
		0,
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(&result)),
	)
	// SHGetKnownFolderPath documentation says we _must_ free the result with
	// CoTaskMemFree, even if the call failed.
	defer CoTaskMemFree.Call(result)
	if hr != 0 {
		return "", windows.Errno(hr)
	}

	// result at this point contains the path, as a PWSTR
	// Note that `go vet` has a false positive here on "misuse of Pointer".
	return windows.UTF16PtrToString((*uint16)(unsafe.Pointer(result))), nil
}
