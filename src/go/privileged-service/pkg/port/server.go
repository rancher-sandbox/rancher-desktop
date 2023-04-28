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

package port

import (
	"encoding/json"
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/debug"

	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
)

const (
	npipeEndpoint = "npipe:////./pipe/rancher_desktop/privileged_service"
	protocol      = "npipe://"
)

// Server is a port server listening for port events from
// RD Guest Agent over vtunnel.
type Server struct {
	proxy       *proxy
	eventLogger debug.Log
	quit        chan interface{}
	listener    net.Listener
	stopped     bool
}

// NewServer creates and returns a new instance of a Port Server.
func NewServer(elog debug.Log) *Server {
	return &Server{
		proxy:       newProxy(),
		eventLogger: elog,
		stopped:     true,
	}
}

// Start initiates the port server on a given host:port
func (s *Server) Start() error {
	s.quit = make(chan interface{})
	c := winio.PipeConfig{
		//
		// SDDL encoded.
		//
		// (system = SECURITY_NT_AUTHORITY | SECURITY_LOCAL_SYSTEM_RID)
		// owner: system
		// ACE Type: (A) Access Allowed
		// grant: (GA) GENERIC_ALL to (WD) Everyone
		//
		SecurityDescriptor: "O:SYD:(A;;GA;;;WD)",
	}
	l, err := winio.ListenPipe(npipeEndpoint[len(protocol):], &c)
	if err != nil {
		return fmt.Errorf("port server listen error: %w", err)
	}
	s.listener = l
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.quit:
				s.eventLogger.Info(uint32(windows.NO_ERROR), "port server received a stop signal")
				return nil
			default:
				return fmt.Errorf("port server connection accept error: %w", err)
			}
		} else {
			go s.handleEvent(conn)
		}
	}
}

func (s *Server) handleEvent(conn net.Conn) {
	defer conn.Close()

	var pm types.PortMapping
	err := json.NewDecoder(conn).Decode(&pm)
	if err != nil {
		s.eventLogger.Error(uint32(windows.ERROR_EXCEPTION_IN_SERVICE), fmt.Sprintf("port server decoding received payload error: %v", err))
		return
	}
	s.eventLogger.Info(uint32(windows.NO_ERROR), fmt.Sprintf("handleEvent for %+v", pm))
	if err = s.proxy.exec(pm); err != nil {
		s.eventLogger.Error(uint32(windows.ERROR_EXCEPTION_IN_SERVICE), fmt.Sprintf("port proxy [%+v] failed: %v", pm, err))
	}
}

// Stop shuts down the server gracefully
func (s *Server) Stop() {
	close(s.quit)
	s.listener.Close()
	s.eventLogger.Info(uint32(windows.NO_ERROR), fmt.Sprintf("remove all %+v", s.proxy.portMappings))
	if err := s.proxy.removeAll(); err != nil {
		s.eventLogger.Warning(uint32(windows.ERROR_EXCEPTION_IN_SERVICE), err.Error())
	}
	s.stopped = true
}
