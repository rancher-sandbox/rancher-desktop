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

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/debug"
	"golang.org/x/sys/windows/svc/eventlog"

	"github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/port"
	privilegedSvc "github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/svc"
)

const (
	portSrvrAddr = "127.0.0.1"
	portSrvrPort = 4444
)

// Run Service runs the Rancher Desktop Privileged Service in Windows services
func RunService(name string, isDebug bool) error {
	elog := initEventlogger(name, isDebug)
	if elog == nil {
		return fmt.Errorf("RunService could not initialize event logger")
	}
	defer elog.Close()
	elog.Info(uint32(windows.NO_ERROR), fmt.Sprintf("starting %s service", name))
	run := svc.Run
	if isDebug {
		run = debug.Run
	}

	portServer := port.NewServer(portSrvrAddr, portSrvrPort, elog)
	supervisor := privilegedSvc.NewSupervisor(portServer, elog)
	err := run(name, supervisor)
	if err != nil {
		elog.Error(uint32(windows.ERROR_EXCEPTION_IN_SERVICE), fmt.Sprintf("%s service failed: %v", name, err))
		return err
	}
	elog.Info(uint32(windows.NO_ERROR), fmt.Sprintf("%s service stopped", name))
	return nil
}

func initEventlogger(name string, isDebug bool) debug.Log {
	var elog debug.Log
	var err error
	if isDebug {
		elog = debug.New(name)
	} else {
		elog, err = eventlog.Open(name)
		if err != nil {
			return elog
		}
	}
	return elog
}
