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

package manage

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	SECURITY_DESCRIPTOR_REVISION = 1
	DACL_SECURITY_INFORMATION    = 4
)

var advapi32 = windows.NewLazySystemDLL("advapi32.dll")

// Install Service installs the Rancher Desktop Privileged Service process as Windows Service
func InstallService(name, displayName, desc string) error {
	instPath, err := getInstallPath(0)
	if err != nil {
		return fmt.Errorf("getting installation path for service [%s] failed: %w", name, err)
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer disconnect(m)

	// We always need uninstall first to unregister,
	// the event logger recreation service can yield to a registry key error
	// e.g RancherDesktopPrivilegedService registry key already exists
	_ = UninstallService(name)

	s, err := m.CreateService(name, instPath, mgr.Config{DisplayName: displayName, Description: desc})
	if err != nil {
		return fmt.Errorf("service creation failed: %w", err)
	}
	defer s.Close()
	if err := setServiceObjectSecurity(s.Handle); err != nil {
		return err
	}

	err = eventlog.InstallAsEventCreate(name, eventlog.Error|eventlog.Warning|eventlog.Info)
	if err != nil {
		_ = s.Delete()
		return fmt.Errorf("setup event log for [%s] failed: %w", name, err)
	}
	return nil
}

func setServiceObjectSecurity(handle windows.Handle) error {
	sd, err := initializeSecurityDescriptor()
	if err != nil {
		return err
	}
	pSetServiceObjectSecurity := advapi32.NewProc("SetServiceObjectSecurity")
	res, _, err := pSetServiceObjectSecurity.Call(uintptr(handle), DACL_SECURITY_INFORMATION, sd.SecurityDescriptor)
	if int(res) == 0 {
		return os.NewSyscallError("SetServiceObjectSecurity", err)
	}
	return nil
}

func initializeSecurityDescriptor() (*syscall.SecurityAttributes, error) {
	pInitializeSecurityDescriptor := advapi32.NewProc("InitializeSecurityDescriptor")
	sd := make([]byte, 4096)
	res, _, err := pInitializeSecurityDescriptor.Call(uintptr(unsafe.Pointer(&sd[0])), SECURITY_DESCRIPTOR_REVISION)
	if int(res) == 0 {
		return nil, os.NewSyscallError("InitializeSecurityDescriptor", err)
	}
	var sa syscall.SecurityAttributes
	sa.Length = uint32(unsafe.Sizeof(sa))
	sa.SecurityDescriptor = uintptr(unsafe.Pointer(&sd[0]))
	return &sa, nil
}

func getInstallPath(handle windows.Handle) (string, error) {
	n := uint32(1024)
	var buf []uint16
	for {
		buf = make([]uint16, n)
		r, err := windows.GetModuleFileName(handle, &buf[0], n)
		if err != nil {
			return "", err
		}
		if r < n {
			break
		}
		// r == n means n not big enough
		n += 1024
	}
	return syscall.UTF16ToString(buf), nil
}
