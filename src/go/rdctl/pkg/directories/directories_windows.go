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
	"unsafe"

	"golang.org/x/sys/windows"
)

// The initial buffer size for use with InvokeWin32WithBuffer
const initialBufferSize = uint32(256)

// InvokeWin32WithBuffer calls the given function with increasing buffer sizes
// until it does not return ERROR_INSUFFICIENT_BUFFER.
func InvokeWin32WithBuffer(cb func(size uint32) error) error {
	size := initialBufferSize
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
	var result *uint16
	hr, _, _ := SHGetKnownFolderPath.Call(
		uintptr(unsafe.Pointer(folder)),
		0,
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(&result)),
	)
	// SHGetKnownFolderPath documentation says we _must_ free the result with
	// CoTaskMemFree, even if the call failed.
	// https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shgetknownfolderpath
	defer func() { _, _, _ = CoTaskMemFree.Call(uintptr(unsafe.Pointer(result))) }()
	if hr != 0 {
		return "", windows.Errno(hr)
	}

	// result at this point contains the path, as a PWSTR
	return windows.UTF16PtrToString(result), nil
}
