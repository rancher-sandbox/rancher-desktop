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

package directories

import (
	"errors"
	"fmt"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// InvokeWin32WithBuffer calls the given function with increasing buffer sizes
// until it does not return ERROR_INSUFFICIENT_BUFFER.
func InvokeWin32WithBuffer(cb func(size int) error) error {
	size := 256
	for {
		err := cb(size)
		if err == nil {
			return nil
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return err
		}
		if size > (1 << 30) {
			return err
		}
		size *= 2
	}
}

// GetApplicationDirectory returns the installation directory of the application.
func GetApplicationDirectory() (string, error) {
	var exePath string
	err := InvokeWin32WithBuffer(func(bufSize int) error {
		buf := make([]uint16, bufSize)
		n, err := windows.GetModuleFileName(windows.Handle(0), &buf[0], uint32(bufSize))
		if err != nil {
			return err
		}
		if n == uint32(bufSize) {
			// If the buffer is too small, GetModuleFileName returns the buffer size,
			// and the result includes the null character. If the buffer is large
			// enough, GetModuleFileName returns the string length, _excluding_ the
			// null character.
			if buf[bufSize-1] == 0 {
				// The buffer contains a null character
				return windows.ERROR_INSUFFICIENT_BUFFER
			}
		}
		exePath = windows.UTF16ToString(buf[:n])
		return nil
	})
	if err != nil {
		return "", err
	}

	// Given the path to the exe, find its directory, and drop the
	// "resources\win32\bin" suffix (possibly with another "resources" in front).
	resultDir := filepath.Dir(exePath)
	for _, part := range []string{"bin", "win32", "resources"} {
		for filepath.Base(resultDir) == part {
			resultDir = filepath.Dir(resultDir)
		}
	}
	return resultDir, nil
}

func GetLocalAppDataDirectory() (string, error) {
	dir, err := getKnownFolder(windows.FOLDERID_LocalAppData)
	if err != nil {
		return "", fmt.Errorf("could not get the AppData folder: %w", err)
	}
	return dir, nil
}

func GetRoamingAppDataDirectory() (string, error) {
	dir, err := getKnownFolder(windows.FOLDERID_RoamingAppData)
	if err != nil {
		return "", fmt.Errorf("could not get the RoamingAppData folder: %w", err)
	}
	return dir, nil
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
