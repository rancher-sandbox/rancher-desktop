package vsock

import (
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
func GetVMGUID(seed string, handshakePort uint32, timeout <-chan time.Time) (hvsock.GUID, error) {
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
		vmGUID, err := hvsock.GUIDFromString(name)
		if err != nil {
			logrus.Errorf("invalid VM name: [%s], err: %v", name, err)
			continue
		}
		go handshake(vmGUID, seed,handshakePort, found, done)
	}
	return tryFindGUID(found, timeout)
}

// handshake attempts to perform a handshake by verifying the seed with a running
// af_vsock peer in WSL distro, it attempts once per second
func handshake(vmGUID hvsock.GUID, seedPhrase string, peerHandshakePort uint32, found chan<- hvsock.GUID, done <-chan bool) {
	svcPort, err := hvsock.GUIDFromString(winio.VsockServiceID(peerHandshakePort).String())
	if err != nil {
		logrus.Errorf("hostHandshake parsing svc port: %v", err)
	}
	addr := hvsock.Addr{
		VMID:      vmGUID,
		ServiceID: svcPort,
	}

	attempInterval := time.NewTicker(time.Second * 1)
	attempt := 1
	for {
		select {
		case <-done:
			logrus.Infof("attempt to handshake with [%s], goroutine is terminated", vmGUID.String())
			return
		case <-attempInterval.C:
			// Spawn a goroutine here to ensure we don't get stuck on a timeout
			go func() {
				conn, err := hvsock.Dial(addr)
				select {
				case <-done:
					// If we're already connected, no need to print more things.
					return
				default:
				}
				if err != nil {
					attempt++
					logrus.Debugf("handshake attempt[%v] to dial into VM [%s], looking for vsock-peer", attempt, vmGUID.String())
					return
				}
				seed, err := readSeed(conn, seedPhrase)
				if err != nil {
					logrus.Errorf("hosthandshake attempt to read the seed: %v", err)
				}
				if err := conn.Close(); err != nil {
					logrus.Errorf("hosthandshake closing connection: %v", err)
				}
				if seed == seedPhrase {
					logrus.Infof("successfully estabilished a handshake with a peer: %s", vmGUID.String())
					found <- vmGUID
					return
				}
				logrus.Infof("hosthandshake failed to match the seed phrase with a peer running in: %s", vmGUID.String())
			}()
		}
	}
}

// tryFindGuid waits on a found chanel to receive a GUID until
// deadline of 10s is reached
func tryFindGUID(found chan hvsock.GUID, timeout <-chan time.Time) (hvsock.GUID, error) {
	for {
		select {
		case vmGUID := <-found:
			return vmGUID, nil
		case <-timeout:
			return hvsock.GUIDZero, errors.New("could not find vsock-peer process on any hyper-v VM(s)")
		}
	}
}

func readSeed(conn net.Conn, seedPhrase string) (string, error) {
	seed := make([]byte, len(seedPhrase))
	if _, err := io.ReadFull(conn, seed); err != nil {
		return "", err
	}
	return string(seed), nil
}