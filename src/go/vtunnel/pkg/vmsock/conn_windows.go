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
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"syscall"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/linuxkit/virtsock/pkg/hvsock"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows/registry"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/util"
)

const (
	timeoutSeconds = 10
	npipe          = "npipe://"
)

type HostConnector struct {
	UpstreamServerAddress string
	VsockListenPort       uint32
	PeerHandshakePort     uint32
}

// ListenAndDial listens for VSOCK connections from
// the peer and dials into the provided TCP address to pipe
// the payload.
func (h *HostConnector) ListenAndDial() error {
	vl, err := h.vsockListen()
	if err != nil {
		return err
	}

	for {
		conn, err := vl.Accept()
		if err != nil {
			logrus.Errorf("ListenAndDial accept connection: %v")
			continue
		}
		go h.handleConn(conn)
	}
}

func (h *HostConnector) handleConn(vConn net.Conn) {
	var conn net.Conn
	var err error
	logrus.Infof("handleConn dialing into upstream: %v", h.UpstreamServerAddress)
	if strings.HasPrefix(h.UpstreamServerAddress, npipe) {
		conn, err = winio.DialPipe(h.UpstreamServerAddress[len(npipe):], nil)
	} else {
		conn, err = net.Dial("tcp", h.UpstreamServerAddress)
	}
	if err != nil {
		logrus.Errorf("handleConn failed dialing into %s: %v", h.UpstreamServerAddress, err)
		return
	}
	defer conn.Close()
	if err := util.Pipe(vConn, conn); err != nil {
		// this can cause by an upstream named pipe
		// when the connection is closed immediately
		// after write
		if errors.Is(err, syscall.ERROR_BROKEN_PIPE) {
			return
		}
		logrus.Errorf("handleConn, stream error: %v", err)
	}
}

func (h *HostConnector) vsockListen() (net.Listener, error) {
	vmGuid, err := h.vmGuid()
	if err != nil {
		return nil, fmt.Errorf("vsockListen, could not determine VM GUID: %v", err)
	}
	svcPort, err := hvsock.GUIDFromString(winio.VsockServiceID(h.VsockListenPort).String())
	if err != nil {
		return nil, fmt.Errorf("vsockListen, could not parse Hyper-v service GUID: %v", err)
	}

	addr := hvsock.Addr{
		VMID:      vmGuid,
		ServiceID: svcPort,
	}

	return hvsock.Listen(addr)
}

// vmGuid retrieves the GUID for a correct hyper-v VM (most likely WSL).
// It performs a handshake with a running peer process in the WSL distro
// to make sure we establish the AF_VSOCK connection with a right VM.
func (h *HostConnector) vmGuid() (hvsock.GUID, error) {
	key, err := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion\HostComputeService\VolatileStore\ComputeSystem`,
		registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("could not open registry key, is WSL VM running? %v", err)
	}
	defer key.Close()

	names, err := key.ReadSubKeyNames(0)
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("machine IDs can not be read in registry: %v", err)
	}
	if len(names) == 0 {
		return hvsock.GUIDZero, errors.New("no running WSL VM found")
	}

	found := make(chan hvsock.GUID, len(names))
	done := make(chan bool, len(names))
	defer close(done)

	for _, name := range names {
		vmGuid, err := hvsock.GUIDFromString(name)
		if err != nil {
			logrus.Errorf("invalid VM name: [%s], err: %v", name, err)
			continue
		}
		go h.handshake(vmGuid, found, done)
	}
	return tryFindGuid(found)
}

// handshake attempts to perform a handshake by verifying the seed with a running
// af_vsock peer in WSL distro, it attempts once per second
func (h *HostConnector) handshake(vmGuid hvsock.GUID, found chan<- hvsock.GUID, done <-chan bool) {
	svcPort, err := hvsock.GUIDFromString(winio.VsockServiceID(h.PeerHandshakePort).String())
	if err != nil {
		logrus.Errorf("hostHandshake parsing svc port: %v", err)
	}
	addr := hvsock.Addr{
		VMID:      vmGuid,
		ServiceID: svcPort,
	}

	attempInterval := time.NewTicker(time.Second * 1)
	attempt := 1
	for {
		select {
		case <-done:
			logrus.Infof("attempt to handshake with [%s], goroutine is terminated", vmGuid.String())
			return
		case <-attempInterval.C:
			conn, err := hvsock.Dial(addr)
			if err != nil {
				attempt++
				logrus.Debugf("handshake attempt[%v] to dial into VM, looking for vsock-peer", attempt)
				continue
			}
			seed, err := readSeed(conn)
			if err != nil {
				logrus.Errorf("hosthandshake attempt to read the seed: %v", err)
			}
			if err := conn.Close(); err != nil {
				logrus.Errorf("hosthandshake closing connection: %v", err)
			}
			if seed == SeedPhrase {
				logrus.Infof("successfully estabilished a handshake with a peer: %s on port: %v", vmGuid.String(), h.PeerHandshakePort)
				found <- vmGuid
				return
			}
			logrus.Infof("hosthandshake failed to match the seed phrase with a peer running in: %s", vmGuid.String())
			return
		}
	}
}

// tryFindGuid waits on a found chanel to receive a GUID until
// deadline of 10s is reached
func tryFindGuid(found chan hvsock.GUID) (hvsock.GUID, error) {
	bailOut := time.After(time.Second * timeoutSeconds)
	for {
		select {
		case vmGuid := <-found:
			return vmGuid, nil
		case <-bailOut:
			return hvsock.GUIDZero, errors.New("could not find vsock-peer process on any hyper-v VM(s)")
		}
	}
}

func readSeed(conn net.Conn) (string, error) {
	seed := make([]byte, len(SeedPhrase))
	if _, err := io.ReadFull(conn, seed); err != nil {
		return "", err
	}
	return string(seed), nil
}
