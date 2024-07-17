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

package svc

import (
	"fmt"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/debug"
	"golang.org/x/sys/windows/svc/eventlog"

	"github.com/pkg/errors"
	"github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/port"
)

// Run Service runs the Rancher Desktop Privileged Service in Windows services
func RunService(name string, isDebug bool) error {
	elog, err := initEventlogger(name, isDebug)
	if err != nil {
		return errors.Wrap(err, "RunService could not initialize event logger")
	}
	defer elog.Close()
	_ = elog.Info(uint32(windows.NO_ERROR), fmt.Sprintf("%s service starting", name))
	run := svc.Run
	if isDebug {
		run = debug.Run
	}

	portServer := port.NewServer(elog)
	supervisor := NewSupervisor(portServer, elog)
	err = run(name, supervisor)
	if err != nil {
		_ = elog.Error(uint32(windows.ERROR_EXCEPTION_IN_SERVICE), fmt.Sprintf("%s service failed: %v", name, err))
		return err
	}
	_ = elog.Info(uint32(windows.NO_ERROR), fmt.Sprintf("%s service stopped", name))
	return nil
}

func initEventlogger(name string, isDebug bool) (debug.Log, error) {
	if isDebug {
		return debug.New(name), nil
	}
	return eventlog.Open(name)
}
