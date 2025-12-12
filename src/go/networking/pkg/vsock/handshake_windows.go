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

package vsock

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/linuxkit/virtsock/pkg/hvsock"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows/registry"
)

// GetVMGUID retrieves the GUID for a correct hyper-v VM (most likely WSL).
// It performs a handshake with a running vsock-peer in the WSL distro
// to make sure we establish the AF_VSOCK connection with a right VM.
func GetVMGUID(ctx context.Context, signature string, handshakePort uint32, timeout <-chan time.Time) (hvsock.GUID, error) {
	key, err := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion\HostComputeService\VolatileStore\ComputeSystem`,
		registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("could not open registry key, is WSL VM running? %v", err)
	}

	names, err := key.ReadSubKeyNames(0)
	if err != nil {
		return hvsock.GUIDZero, fmt.Errorf("machine IDs cannot be read in registry: %v", err)
	}
	if len(names) == 0 {
		return hvsock.GUIDZero, errors.New("no running WSL VM found")
	}

	key.Close()

	ctx, cancel := context.WithCancel(ctx)
	found := make(chan hvsock.GUID, len(names))

	for _, name := range names {
		vmGUID, err := hvsock.GUIDFromString(name)
		if err != nil {
			logrus.Errorf("invalid VM name: [%s], err: %v", name, err)
			continue
		}
		go handshake(ctx, vmGUID, handshakePort, signature, found)
	}
	return tryFindGUID(cancel, found, timeout)
}

// GetVsockConnection establishes a new AF_VSOCK connection with
// the provided VM GUID and port, the caller is responsible for closing the connection
func GetVsockConnection(vmGUID hvsock.GUID, port uint32) (net.Conn, error) {
	svcPort, err := hvsock.GUIDFromString(winio.VsockServiceID(port).String())
	if err != nil {
		return nil, err
	}
	addr := hvsock.Addr{
		VMID:      vmGUID,
		ServiceID: svcPort,
	}

	return hvsock.Dial(addr)
}

// handshake with the Hyper-V VM by verifying the fixed signature over AF_VSOCK once
// per second, in order to identify the VM running the WSL distro.
func handshake(ctx context.Context, vmGUID hvsock.GUID, peerHandshakePort uint32, signaturePhrase string, found chan<- hvsock.GUID) {
	attemptInterval := time.NewTicker(time.Second * 1)
	attempt := 0
	for {
		select {
		case <-ctx.Done():
			logrus.Infof("attempt to handshake with [%s], goroutine is terminated", vmGUID.String())
			return
		case <-attemptInterval.C:
			// Spawn a goroutine here to ensure we don't
			// get stuck on a timeout from hvsock.Dial
			go func() {
				conn, err := GetVsockConnection(vmGUID, peerHandshakePort)
				select {
				case <-ctx.Done():
					return
				default:
				}
				if err != nil {
					attempt++
					logrus.Debugf("handshake attempt[%v] to dial into VM [%s], looking for vsock-peer failed: %v", attempt, vmGUID.String(), err)
					return
				}
				signature, err := readSignature(conn, signaturePhrase)
				if err != nil {
					logrus.Errorf("handshake attempt to read the signature: %v", err)
				}
				if err := conn.Close(); err != nil {
					logrus.Errorf("handshake closing connection: %v", err)
				}
				if signature == signaturePhrase {
					logrus.Infof("successfully established a handshake with a peer: %s", vmGUID.String())
					found <- vmGUID
					return
				}
				logrus.Infof("handshake failed to match the signature phrase with a peer running in: %s", vmGUID.String())
			}()
		}
	}
}

// tryFindGuid waits on a found channel to receive a GUID until
// deadline of 10s is reached
func tryFindGUID(cancel context.CancelFunc, found chan hvsock.GUID, timeout <-chan time.Time) (hvsock.GUID, error) {
	defer cancel()
	for {
		select {
		case vmGUID := <-found:
			return vmGUID, nil
		case <-timeout:
			return hvsock.GUIDZero, errors.New("could not find vsock-peer process on any hyper-v VM(s)")
		}
	}
}

// readSignature reads the signature that was received from the peer process
// in the vm, and writes its own signature immediately after read. This
// will allow the peer process to also confirm the host daemon.
func readSignature(conn net.Conn, signaturePhrase string) (string, error) {
	signature := make([]byte, len(signaturePhrase))
	if _, err := io.ReadFull(conn, signature); err != nil {
		return "", err
	}
	return string(signature), nil
}
