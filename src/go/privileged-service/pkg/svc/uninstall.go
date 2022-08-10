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

package svc

import (
	"fmt"

	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

// Uninstall Service removes the Rancher Desktop Privileged Service process from Windows Services
func UninstallService(name string) error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service [%s] failed: %w", name, err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err != nil {
		return fmt.Errorf("service [%s] is not installed: %w", name, err)
	}
	defer s.Close()
	if err = s.Delete(); err != nil {
		return fmt.Errorf("service [%s] delete failed: %w", name, err)
	}
	if err = eventlog.Remove(name); err != nil {
		return fmt.Errorf("remove event log for [%s] failed: %w", name, err)
	}
	return nil
}
