/*
Copyright © 2021 SUSE LLC

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

	"github.com/pkg/errors"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

// Install Service installs the Rancher Desktop Privileged Service process as Windows Service
func InstallService(name, desc string) error {
	instPath, err := getInstallPath(0)
	if err != nil {
		return fmt.Errorf("getting installation path for service [%s] failed: %w", name, err)
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.CreateService(name, instPath, mgr.Config{DisplayName: desc}, "auto-started")
	if errors.Is(err, windows.ERROR_DUPLICATE_SERVICE_NAME) {
		return errors.Wrapf(os.ErrExist, "service [%s] already exists", name)
	}
	defer s.Close()
	err = eventlog.InstallAsEventCreate(name, eventlog.Error|eventlog.Warning|eventlog.Info)
	if err != nil {
		s.Delete()
		return fmt.Errorf("setup event log for [%s] failed: %w", name, err)
	}
	return nil
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
