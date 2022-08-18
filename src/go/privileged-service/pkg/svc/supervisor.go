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

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/debug"

	"github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/port"
)

// supervisor implements service handler interface for
// Rancher Desktop Privileged Service
type supervisor struct {
	eventLogger debug.Log
	portServer  *port.Server
}

func NewSupervisor(portServer *port.Server, logger debug.Log) *supervisor {
	return &supervisor{
		eventLogger: logger,
		portServer:  portServer,
	}
}

// Execute is the core of the supervisor service to handle all
// the service related event requests. Any outside function
// calls MUST be called in a goroutine.
// The signature must NOT change since it is part of the standard
// service handler interface
// This implements the [golang.org/x/sys/windows/svc.Handler] interface
func (s *supervisor) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPauseAndContinue
	changes <- svc.Status{State: svc.StartPending}
	errCh := make(chan error)
	go s.portServer.Start(errCh)
	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}
loop:
	for {
		select {
		case e := <-errCh:
			s.eventLogger.Error(uint32(windows.ERROR_EXCEPTION_IN_SERVICE), fmt.Sprintf("supervisor failed to start: %v", e))
			return false, uint32(windows.ERROR_SERVICE_NEVER_STARTED)
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				s.portServer.Stop()
				s.eventLogger.Info(uint32(windows.NO_ERROR), "supervisor is stopped")
				changes <- svc.Status{State: svc.Stopped, Accepts: cmdsAccepted}
				break loop
			case svc.Pause:
				s.portServer.Stop()
				changes <- svc.Status{State: svc.Paused, Accepts: cmdsAccepted}
				s.eventLogger.Info(uint32(windows.NO_ERROR), "supervisor is paused")
			case svc.Continue:
				go s.portServer.Start(errCh)
				changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}
				s.eventLogger.Info(uint32(windows.NO_ERROR), "supervisor continue")
			default:
				s.eventLogger.Error(uint32(windows.ERROR_INVALID_SERVICE_CONTROL), fmt.Sprintf("unexpected control request #%d", c))
			}
		}
	}
	changes <- svc.Status{State: svc.StopPending}
	return false, 0
}
