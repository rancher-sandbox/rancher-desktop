/*
Copyright © 2025 SUSE LLC
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

package main

import (
	"context"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/sirupsen/logrus"
	"github.com/songgao/packets/ethernet"
	"github.com/songgao/water"
	"github.com/vishvananda/netlink"
	"gvisor.dev/gvisor/pkg/tcpip/header"

	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/log"
)

var (
	debug            bool
	vsockFD          int
	dhcpScript       string
	tapIface         string
	logFile          string
	subnet           string
	tapDeviceMacAddr string
)

const (
	defaultTapDevice = "eth0"
	defaultVsockFD   = 3
	maxMTU           = 4000
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable debug flag")
	flag.StringVar(&tapIface, "tap-interface", defaultTapDevice, "tap interface name, eg. eth0, eth1")
	flag.IntVar(&vsockFD, "vsock-fd", defaultVsockFD, "file descriptor for vsock connection")
	flag.StringVar(&dhcpScript, "dhcp-script", "", "script to run on DHCP events")
	flag.StringVar(&tapDeviceMacAddr, "tap-mac-address", config.TapDeviceMacAddr,
		"MAC address that is associated to the tap interface")
	flag.StringVar(&subnet, "subnet", config.DefaultSubnet,
		fmt.Sprintf("Subnet range with CIDR suffix that is associated to the tap interface, e,g: %s", config.DefaultSubnet))
	flag.StringVar(&logFile, "logfile", "/var/log/vm-switch.log", "path to vm-switch process logfile")
	flag.Parse()

	if err := log.SetOutputFile(logFile, logrus.StandardLogger()); err != nil {
		logrus.Fatalf("setting logger's output file failed: %v", err)
	}

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	// the FD is passed-in as an extra arg from exec.Command
	// of the parent process. This is for the AF_VSOCK connection that
	// is handed over from the default namespace to Rancher Desktop's
	// network namespace, the logic behind this approach is because
	// AF_VSOCK is affected by network namespaces, therefore we need
	// to open it before entering a new namespace (via unshare/nsenter)
	connFile := os.NewFile(uintptr(vsockFD), "vsock connection")

	logrus.Debugf("using a AF_VSOCK connection file from default namespace: %v", connFile)

	// this should never happen
	if err := checkForExistingIface(tapIface); err != nil {
		logrus.Fatal(err)
	}

	// catch user issued signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	for {
		ctx, cancel := context.WithCancel(context.Background())
		select {
		case s := <-sigChan:
			logrus.Errorf("signal caught: %v", s)
			cancel()
			connFile.Close()
			os.Exit(1)
		default:
			if err := run(ctx, cancel, connFile); err != nil {
				logrus.Error(err)
			}
			// Wait one second before attempting to re-establish connection.
			time.Sleep(time.Second)
		}
	}
}

func run(ctx context.Context, cancel context.CancelFunc, connFile io.ReadWriteCloser) error {
	tap, err := water.New(water.Config{
		DeviceType: water.TAP,
		PlatformSpecificParams: water.PlatformSpecificParams{
			Name: tapIface,
		},
	})
	if err != nil {
		logrus.Fatalf("creating tap device %v failed: %s", tapIface, err)
	}
	logrus.Debugf("created tap device %s: %v", tapIface, tap)

	defer func() {
		connFile.Close()
		tap.Close()
		logrus.Debugf("closed tap device: %s", tapIface)
	}()

	if err := linkUp(tapIface, tapDeviceMacAddr); err != nil {
		logrus.Fatalf("setting mac address [%s] for %s tap device failed: %s", tapDeviceMacAddr, tapIface, err)
	}
	if err := loopbackUp(); err != nil {
		logrus.Fatalf("enabling loop back device failed: %s", err)
	}

	logrus.Debugf("setup complete for tap interface %s(%s) + loopback", tapIface, tapDeviceMacAddr)

	errCh := make(chan error, 1)
	go tx(ctx, connFile, tap, errCh, maxMTU)
	go rx(ctx, connFile, tap, errCh, maxMTU)
	go func() {
		if err := dhcp(ctx, tapIface); err != nil {
			errCh <- fmt.Errorf("dhcp error: %w", err)
			cancel()
		}
	}()

	return <-errCh
}

func loopbackUp() error {
	lo, err := netlink.LinkByName("lo")
	if err != nil {
		return err
	}

	return netlink.LinkSetUp(lo)
}

func linkUp(iface, mac string) error {
	link, err := netlink.LinkByName(iface)
	if err != nil {
		return err
	}
	if mac == "" {
		return netlink.LinkSetUp(link)
	}
	hw, err := net.ParseMAC(mac)
	if err != nil {
		return err
	}
	if err := netlink.LinkSetHardwareAddr(link, hw); err != nil {
		return err
	}

	logrus.Debugf("successful link setup %+v\n", link)
	return netlink.LinkSetUp(link)
}

func dhcp(ctx context.Context, iface string) error {
	args := []string{"-f", "-i", iface}
	if dhcpScript != "" {
		args = append(args, "-s", dhcpScript)
	}
	cmd := exec.CommandContext(ctx, "udhcpc", args...)
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	return cmd.Run()
}

func rx(ctx context.Context, conn io.Writer, tap *water.Interface, errCh chan error, mtu int) {
	logrus.Info("waiting for packets...")
	if mtu > math.MaxUint16 {
		errCh <- fmt.Errorf("invalid MTU %d", mtu)
		return
	}
	var frame ethernet.Frame
	for {
		select {
		case <-ctx.Done():
			logrus.Info("exiting rx goroutine")
			return
		default:
			frame.Resize(mtu)
			n, err := tap.Read([]byte(frame))
			if err != nil {
				errCh <- fmt.Errorf("reading packet from tap failed: %w", err)
				return
			}
			frame = frame[:n]

			size := make([]byte, 2)
			binary.LittleEndian.PutUint16(size, uint16(n))

			if _, err := conn.Write(size); err != nil {
				errCh <- fmt.Errorf("writing size to the socket failed: %w", err)
				return
			}
			if _, err := conn.Write(frame); err != nil {
				errCh <- fmt.Errorf("writing packet to the socket failed: %w", err)
				return
			}

			if debug {
				packet := gopacket.NewPacket(frame, layers.LayerTypeEthernet, gopacket.Default)
				logrus.Infof("wrote packet (vm -> host %d): %s", size, packet.String())
			}
		}
	}
}

func tx(ctx context.Context, conn io.Reader, tap *water.Interface, errCh chan error, mtu int) {
	sizeBuf := make([]byte, 2)
	buf := make([]byte, mtu+header.EthernetMinimumSize)

	for {
		select {
		case <-ctx.Done():
			logrus.Info("exiting tx goroutine")
			return
		default:
			n, err := io.ReadFull(conn, sizeBuf)
			if err != nil {
				errCh <- fmt.Errorf("reading size from socket failed: %w", err)
				return
			}
			if n != 2 {
				errCh <- fmt.Errorf("unexpected size %d", n)
				return
			}
			size := int(binary.LittleEndian.Uint16(sizeBuf[0:2]))

			if cap(buf) < size {
				buf = make([]byte, size)
			}

			n, err = io.ReadFull(conn, buf[:size])
			if err != nil {
				errCh <- fmt.Errorf("reading payload from socket failed: %w", err)
				return
			}
			if n == 0 || n != size {
				errCh <- fmt.Errorf("unexpected size %d != %d", n, size)
				return
			}

			if _, err := tap.Write(buf[:size]); err != nil {
				errCh <- fmt.Errorf("writing packet to tap failed: %w", err)
				return
			}

			if debug {
				packet := gopacket.NewPacket(buf[:size], layers.LayerTypeEthernet, gopacket.Default)
				logrus.Infof("read packet (host -> vm %d): %s", size, packet.String())
			}
		}
	}
}

func checkForExistingIface(ifName string) error {
	// equivalent to: `ip link show`
	links, err := netlink.LinkList()
	if err != nil {
		return fmt.Errorf("getting link devices failed: %w", err)
	}

	for _, link := range links {
		if link.Attrs().Name == ifName {
			return fmt.Errorf("%s interface already exist, exiting now", ifName)
		}
	}
	return nil
}
