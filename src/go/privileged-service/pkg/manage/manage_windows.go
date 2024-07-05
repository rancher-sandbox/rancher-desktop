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
	"context"
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	queryTimeout           = 300 * time.Millisecond
	desiredStateTimeout    = 10 * time.Second
	SERVICE_MINIMAL_ACCESS = windows.SERVICE_QUERY_STATUS | windows.SERVICE_START | windows.SERVICE_STOP | windows.SERVICE_INTERROGATE
)

// Start Service start the Rancher Desktop Privileged Service process in Windows Services
func StartService(name string) error {
	m, err := connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := openService(m.Handle, name)
	if err != nil {
		return fmt.Errorf("could not access service: %w", err)
	}
	defer s.Close()
	if err = s.Start(); err != nil {
		if !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
			return fmt.Errorf("could not start service: %w", err)
		}
	}
	return nil
}

// Control Service manages Stop, Pause and Continue for Rancher Desktop Privileged Service
func ControlService(name string, control svc.Cmd, desiredState svc.State) error {
	m, err := connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := openService(m.Handle, name)
	if err != nil {
		return fmt.Errorf("could not access service: %w", err)
	}
	defer s.Close()
	status, err := s.Control(control)
	if err != nil {
		return fmt.Errorf("could not send control=%d: %w", control, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), desiredStateTimeout)
	defer cancel()
	for status.State != desiredState {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for service to go to state=%d: %w", desiredState, os.ErrDeadlineExceeded)
		case <-time.After(queryTimeout):
			status, err = s.Query()
			if err != nil {
				return fmt.Errorf("could not retrieve service status: %w", err)
			}
		}
	}
	return nil
}

// connect is same as mgr.Connect with minimal
// access control
func connect() (*mgr.Mgr, error) {
	h, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return nil, err
	}
	return &mgr.Mgr{Handle: h}, nil
}

// connect is same as mgr.OpenService with minimal
// access control
func openService(svcHandle windows.Handle, name string) (*mgr.Service, error) {
	h, err := windows.OpenService(svcHandle, syscall.StringToUTF16Ptr(name), SERVICE_MINIMAL_ACCESS)
	if err != nil {
		return nil, err
	}
	return &mgr.Service{Name: name, Handle: h}, nil
}
