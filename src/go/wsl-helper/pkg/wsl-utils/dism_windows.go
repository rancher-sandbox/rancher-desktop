/*
Copyright © 2023 SUSE LLC

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

package wslutils

// This file is a helper for interacting with the Windows Deployment Image
// Servicing and Management (DISM) APIs.  It lets us install Windows optional
// features with logging.

import (
	"context"
	"fmt"
	"unsafe"

	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
)

type dismSession uint

const (
	// kWindowsFeature is the name of the Windows feature that needs to be
	// installed.
	kWindowsFeature = "VirtualMachinePlatform"
	// DISM_ONLINE_IMAGE is the DISM "image path" that signifies we're trying
	// to modify the running Windows installation.
	DISM_ONLINE_IMAGE         = "DISM_{53BFAE52-B167-4E2F-A258-0A37B57FF845}"
	DismLogErrorsWarningsInfo = 2
)

var (
	dllDismApi        = windows.NewLazySystemDLL("dismapi.dll")
	dismInitialize    = dllDismApi.NewProc("DismInitialize")
	dismOpenSession   = dllDismApi.NewProc("DismOpenSession")
	dismCloseSession  = dllDismApi.NewProc("DismCloseSession")
	dismEnableFeature = dllDismApi.NewProc("DismEnableFeature")
)

func errorFromHResult(hr int32, err error) error {
	var result error
	if hr < 0 {
		result = windows.Errno(hr)
		if err != nil {
			result = fmt.Errorf("%w: %w", result, err)
		}
		return result
	}
	return nil
}

// DismDoInstall installs the Virtual Machine Platform Windows feature.
func DismDoInstall(ctx context.Context, log *logrus.Entry) error {
	var session dismSession

	hr, _, err := dismInitialize.Call(
		uintptr(DismLogErrorsWarningsInfo),
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(nil)),
	)
	err = errorFromHResult(int32(hr), err)
	if err != nil {
		return fmt.Errorf("error initializing DISM: %w", err)
	}

	buf, err := windows.UTF16PtrFromString(DISM_ONLINE_IMAGE)
	if err != nil {
		log.WithError(err).Error("Failed to convert DISM_ONLINE_IMAGE")
		return err
	}
	hr, _, err = dismOpenSession.Call(
		uintptr(unsafe.Pointer(buf)),
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(nil)),
		uintptr(unsafe.Pointer(&session)),
	)
	if hr != uintptr(windows.S_OK) {
		return errorFromWin32("failed to open DISM session", hr&0xFFFF, err)
	}
	defer dismCloseSession.Call(uintptr(session))

	if buf, err = windows.UTF16PtrFromString(kWindowsFeature); err != nil {
		log.WithError(err).Error("Failed to convert kWindowsFeature")
		return err
	}

	hr, _, err = dismEnableFeature.Call(
		uintptr(session),
		uintptr(unsafe.Pointer(buf)),
		uintptr(unsafe.Pointer(nil)), // Identifier
		uintptr(unsafe.Pointer(nil)), // PackageIdentifier
		uintptr(0),                   // LimitAccess
		uintptr(unsafe.Pointer(nil)), // SourcePaths
		uintptr(0),                   // SourcePathCount
		uintptr(1),                   // EnableAll
		uintptr(unsafe.Pointer(nil)), // CancelEvent
		uintptr(unsafe.Pointer(nil)), // Progress
		uintptr(unsafe.Pointer(nil)), // UserData
	)
	if hr != uintptr(windows.ERROR_SUCCESS_REBOOT_REQUIRED) {
		log.WithError(err).WithField("hr", fmt.Sprintf("%08x", hr)).Trace("DismEnableFeature")
	}
	err = errorFromHResult(int32(hr), err)
	if err != nil {
		return fmt.Errorf("error enabling feature %q: %w", kWindowsFeature, err)
	}
	log.Tracef("Windows feature %q enabled", kWindowsFeature)
	return nil
}
