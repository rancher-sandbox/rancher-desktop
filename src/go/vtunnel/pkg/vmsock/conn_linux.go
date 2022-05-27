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
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/util"
	"github.com/sirupsen/logrus"
)

// PeerHanshake listens for incoming VSOCK connections from the Host process
// The handshake is perfomed once during startup/restart to make sure that
// host process is talking to a right hyper-v VM (most likely WSL)
func PeerHandshake() {
	l, err := vsock.Listen(vsock.CIDAny, PeerHandshakePort)
	if err != nil {
		logrus.Fatalf("PeerHandshake listen for incoming vsock: %v", err)
	}
	defer l.Close()

	for {
		conn, err := l.Accept()
		if err != nil {
			logrus.Errorf("PeerHandshake accepting incoming socket connection: %v", err)
		}
		_, err = conn.Write([]byte(SeedPhrase))
		if err != nil {
			logrus.Errorf("PeerHandshake writing seed phrase: %v", err)
		}

		conn.Close()
		logrus.Info("successful handshake with vsock-host")
	}
}

func ListenTCP(addr string, port int) error {
	l, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.ParseIP(addr), Port: port})
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
		go handleTCP(conn)
	}
}

func handleTCP(tConn net.Conn) {
	vConn, err := vsock.Dial(vsock.CIDHost, HostListenPort)
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
