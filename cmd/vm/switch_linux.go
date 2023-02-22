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

package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/sirupsen/logrus"
	"github.com/songgao/packets/ethernet"
	"github.com/songgao/water"
	"github.com/vishvananda/netlink"
	"gvisor.dev/gvisor/pkg/tcpip/header"
)

var (
	debug    bool
	tapIface string
)

const (
	defaultTapDevice = "eth0"
	defaultMacAddr   = "5a:94:ef:e4:0c:ee"
	defaultMTU       = 4000
)

func main() {
	flag.BoolVar(&debug, "debug", true, "enable debug flag")
	flag.StringVar(&tapIface, "tap-interface", defaultTapDevice, "tap interface name, eg. eth0, eth1")
	flag.Parse()

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	// the FD is passed-in as an extra arg from exec.Command
	// of the parent process. This is for the AF_VSOCK connection that
	// is handed over from the default namespace to Rancher Desktop's
	// network namespace (rd1), the logic behind this approach was the
	// lack of support for network namespaces in the AF_VSOCK libs.
	connFile := os.NewFile(uintptr(3), "RancherDesktop-AFVsock-Connection")
	defer connFile.Close()

	logrus.Debugf("using a AF_VSOCK connection file from default namespace: %v", connFile)

	// this should never happen
	if err := checkForExsitingIf(tapIface); err != nil {
		logrus.Fatal(err)
	}

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
		tap.Close()
		logrus.Debugf("closed tap device: %s", tapIface)
	}()

	if err := linkUp(tapIface, defaultMacAddr); err != nil {
		logrus.Fatalf("setting mac address [%s] for %s tap device failed: %s", defaultMacAddr, tapIface, err)
	}
	if err := loopbackUp(); err != nil {
		logrus.Fatalf("enabling loop back device failed: %s", err)
	}

	logrus.Debugf("setup complete for tap interface %s(%s) + loopback", tapIface, defaultMacAddr)

	for {
		if err := run(connFile, tap); err != nil {
			logrus.Error(err)
		}
		time.Sleep(time.Second)
	}
}

func run(connFile *os.File, tap *water.Interface) error {
	errCh := make(chan error, 1)
	go tx(connFile, tap, errCh, defaultMTU)
	go rx(connFile, tap, errCh, defaultMTU)
	go func() {
		if err := dhcp(tapIface); err != nil {
			errCh <- fmt.Errorf("dhcp error: %w", err)
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

func dhcp(iface string) error {
	if _, err := exec.LookPath("udhcpc"); err == nil { // busybox dhcp client
		cmd := exec.Command("udhcpc", "-f", "-q", "-i", iface, "-v")
		cmd.Stderr = os.Stderr
		cmd.Stdout = os.Stdout
		return cmd.Run()
	}
	cmd := exec.Command("dhclient", "-4", "-d", "-v", iface)
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	return cmd.Run()
}

func rx(conn io.Writer, tap *water.Interface, errCh chan error, mtu int) {
	logrus.Info("waiting for packets...")
	var frame ethernet.Frame
	for {
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

func tx(conn io.Reader, tap *water.Interface, errCh chan error, mtu int) {
	sizeBuf := make([]byte, 2)
	buf := make([]byte, mtu+header.EthernetMinimumSize)

	for {
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

func checkForExsitingIf(ifName string) error {
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
