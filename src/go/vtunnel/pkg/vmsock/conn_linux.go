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

package vmsock

import (
	"fmt"
	"net"

	"github.com/linuxkit/virtsock/pkg/vsock"
	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/util"
)

type PeerConnector struct {
	IPv4ListenAddress  string
	TCPListenPort      int
	VsockHandshakePort uint32
	VsockHostPort      uint32
}

// ListenAndHandshake listens for incoming VSOCK connections from the Host process
// The handshake is performed once during startup/restart to make sure that
// host process is talking to a right hyper-v VM (most likely WSL)
func (p *PeerConnector) ListenAndHandshake() {
	l, err := vsock.Listen(vsock.CIDAny, p.VsockHandshakePort)
	if err != nil {
		logrus.Fatalf("PeerHandshake listen for incoming vsock: %v", err)
	}
	defer l.Close()

	for {
		conn, err := l.Accept()
		if err != nil {
			logrus.Errorf("PeerHandshake accepting incoming socket connection: %v", err)
			continue
		}
		_, err = conn.Write([]byte(SeedPhrase))
		if err != nil {
			logrus.Errorf("PeerHandshake writing seed phrase: %v", err)
		}

		conn.Close()
		logrus.Info("successful handshake with vsock-host")
	}
}

// ListenTCP starts a tcp listener and accepts TCP connections on a given port and addr
// when a new connection is accepted, ListenTCP handles the connection by establishing
// virtual socket to the host and sends the packets over the AF_VSOCK
func (p *PeerConnector) ListenTCP() error {
	l, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.ParseIP(p.IPv4ListenAddress), Port: p.TCPListenPort})
	if err != nil {
		return fmt.Errorf("ListenTCP: %w", err)
	}
	defer l.Close()

	for {
		conn, err := l.Accept()
		if err != nil {
			logrus.Errorf("ListenTCP accept connection: %v", err)
			continue
		}
		go p.handleTCP(conn)
	}
}

func (p *PeerConnector) handleTCP(tConn net.Conn) {
	defer tConn.Close()
	vConn, err := vsock.Dial(vsock.CIDHost, p.VsockHostPort)
	if err != nil {
		logrus.Fatalf("handleTCP dial to vsock host: %v", err)
	}
	defer vConn.Close()

	err = util.Pipe(tConn, vConn)
	if err != nil {
		logrus.Errorf("handleTCP, stream error: %v", err)
		return
	}
}
