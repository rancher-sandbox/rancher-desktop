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
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"strconv"

	"github.com/linuxkit/virtsock/pkg/vsock"
	"github.com/sirupsen/logrus"
	"github.com/vishvananda/netns"

	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/log"
	rdvsock "github.com/rancher-sandbox/rancher-desktop-networking/pkg/vsock"
)

var (
	debug            bool
	vmSwitchPath     string
	unshareArg       string
	logFile          string
	vmSwitchLogFile  string
	tapIface         string
	subnet           string
	tapDeviceMacAddr string
)

const (
	nsenter            = "/usr/bin/nsenter"
	unshare            = "/usr/bin/unshare"
	vsockHandshakePort = 6669
	vsockDialPort      = 6656
	defaultTapDevice   = "eth0"
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging")
	flag.StringVar(&tapIface, "tap-interface", defaultTapDevice, "tap interface name, eg. eth0, eth1")
	flag.StringVar(&subnet, "subnet", config.DefaultSubnet,
		fmt.Sprintf("Subnet range with CIDR suffix that is associated to the tap interface, e,g: %s", config.DefaultSubnet))
	flag.StringVar(&tapDeviceMacAddr, "tap-mac-address", config.TapDeviceMacAddr,
		"MAC address that is associated to the tap interface")
	flag.StringVar(&vmSwitchPath, "vm-switch-path", "", "the path to the vm-switch binary that will run in a new namespace")
	flag.StringVar(&vmSwitchLogFile, "vm-switch-logfile", "", "path to the logfile for vm-switch process")
	flag.StringVar(&unshareArg, "unshare-arg", "", "the command argument to pass to the unshare program")
	flag.StringVar(&logFile, "logfile", "/var/log/network-setup.log", "path to the logfile for network setup process")
	flag.Parse()

	if err := log.SetOutputFile(logFile, logrus.StandardLogger()); err != nil {
		logrus.Fatalf("setting logger's output file failed: %v", err)
	}

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	if vmSwitchPath == "" {
		logrus.Fatal("path to the vm-switch process must be provided")
	}

	if unshareArg == "" {
		logrus.Fatal("unshare program arg must be provided")
	}

	// listenForHandshake blocks until a successful handshake is estabilished.
	listenForHandshake()

	logrus.Debugf("attempting to connect to the host on CID: %v and Port: %d", vsock.CIDHost, vsockDialPort)
	vsockConn, err := vsock.Dial(vsock.CIDHost, vsockDialPort)
	if err != nil {
		logrus.Fatal(err)
	}
	logrus.Debugf("successful connection to host on CID: %v and Port: %d: connection: %+v", vsock.CIDHost, vsockDialPort, vsockConn)

	// setup network namespace
	ns, err := configureNamespace()
	if err != nil {
		logrus.Fatal(err)
	}

	if err := unshareCmd(ns, unshareArg); err != nil {
		logrus.Fatal(err)
	}

	// Start the vm-switch process in the new namespace; we do
	// this as the golang runtime can switch threads at will, so it
	// is safer to have a whole process in a consistent namespace.
	args := []string{
		fmt.Sprintf("-n/proc/%d/fd/%d", os.Getpid(), ns),
		"-F",
		vmSwitchPath,
		"-tap-interface",
		tapIface,
		"-subnet",
		subnet,
		"-tap-mac-address",
		tapDeviceMacAddr,
	}
	if vmSwitchLogFile != "" {
		args = append(args, "-logfile", vmSwitchLogFile)
	}
	if debug {
		args = append(args, "-debug")
	}
	vmSwitchCmd := exec.Command(nsenter, args...)

	connFile, err := vsockConn.File()
	if err != nil {
		logrus.Fatal(err)
	}
	// pass in the vsock connection as a FD to the
	// vm-switch process in the newely created namespace
	vmSwitchCmd.ExtraFiles = []*os.File{connFile}
	if err := vmSwitchCmd.Start(); err != nil {
		logrus.Fatalf("could not start the vm-switch process: %v", err)
	}
	logrus.Infof("successfully started the vm-switch running with a PID: %v", vmSwitchCmd.Process.Pid)

	if err := vmSwitchCmd.Wait(); err != nil {
		logrus.Errorf("vm-switch exited with error: %v", err)
	}
}

func unshareCmd(ns netns.NsHandle, args string) error {
	unshareCmd := exec.Command( //nolint:gosec // no security concern with the potentially tainted command arguments
		nsenter, fmt.Sprintf("-n/proc/%d/fd/%d", os.Getpid(), ns), "-F",
		unshare, "--pid", "--mount-proc", "--fork", "--propagation", "slave", args)
	unshareCmd.Stdout = os.Stdout
	unshareCmd.Stderr = os.Stderr
	if err := unshareCmd.Start(); err != nil {
		return fmt.Errorf("could not start the unshare process: %w", err)
	}

	if err := writeWSLInitPid(unshareCmd.Process.Pid); err != nil {
		return fmt.Errorf("writing wsl-init.pid failed: %w", err)
	}

	logrus.Debugf("successfully wrote wsl-init.pid with: %d", unshareCmd.Process.Pid)
	return nil
}

func writeWSLInitPid(pid int) error {
	unsharePID := strconv.Itoa(pid)

	writePermission := 0600
	err := os.WriteFile("/run/wsl-init.pid", []byte(unsharePID), fs.FileMode(writePermission))
	if err != nil {
		return err
	}
	return nil
}

func listenForHandshake() {
	logrus.Info("starting handshake process with host-switch")
	l, err := vsock.Listen(vsock.CIDAny, vsockHandshakePort)
	if err != nil {
		logrus.Error(err)
	}
	defer l.Close()
	for {
		conn, err := l.Accept()
		if err != nil {
			logrus.Errorf("listenForHandshake connection accept failed: %v", err)
			continue
		}
		_, err = conn.Write([]byte(rdvsock.SignaturePhrase))
		if err != nil {
			logrus.Errorf("listenForHandshake writing signature phrase failed: %v", err)
		}

		// verify that the host-switch is ready for us to estabilish the connection
		buf := make([]byte, len(rdvsock.ReadySignal))
		if _, err := io.ReadFull(conn, buf); err != nil {
			logrus.Errorf("listenForHandshake reading signature phrase failed: %v", err)
		}
		if string(buf) == rdvsock.ReadySignal {
			break
		}
		conn.Close()
	}
	logrus.Info("listenForHandshake successful handshake with host-switch")
}

func configureNamespace() (netns.NsHandle, error) {
	ns, err := netns.New()
	if err != nil {
		return netns.None(), fmt.Errorf("creating new namespace failed")
	}

	logrus.Infof("created a new namespace %v %v", ns, ns.String())
	return ns, nil
}
