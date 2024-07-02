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
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"strconv"

	"github.com/linuxkit/virtsock/pkg/vsock"
	"github.com/sirupsen/logrus"
	"github.com/vishvananda/netlink"
	"github.com/vishvananda/netns"
	"golang.org/x/sys/unix"

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
	nsenter              = "/usr/bin/nsenter"
	unshare              = "/usr/bin/unshare"
	vsockHandshakePort   = 6669
	vsockDialPort        = 6656
	defaultTapDevice     = "eth0"
	defaultNSVeth        = "veth-rd0"
	rancherDesktopNSVeth = "veth-rd1"
	defaultNamespacePID  = 1
	cidrOnes             = 24
	cidrBits             = 32
)

func main() {
	initializeFlags()

	setupLogging(logFile)

	if vmSwitchPath == "" {
		logrus.Fatal("path to the vm-switch process must be provided")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), unix.SIGTERM, unix.SIGHUP, unix.SIGQUIT)
	defer cancel()

	if unshareArg == "" {
		logrus.Fatal("unshare program arg must be provided")
	}

	// listenForHandshake blocks until a successful handshake is established.
	listenForHandshake(ctx)

	logrus.Debugf("attempting to connect to the host on CID: %v and Port: %d", vsock.CIDHost, vsockDialPort)
	vsockConn, err := vsock.Dial(vsock.CIDHost, vsockDialPort)
	if err != nil {
		logrus.Fatal(err)
	}
	logrus.Debugf("successful connection to host on CID: %v and Port: %d: connection: %+v", vsock.CIDHost, vsockDialPort, vsockConn)

	originNS, err := netns.Get()
	if err != nil {
		logrus.Errorf("failed getting a handle to the current namespace: %v", err)
	}

	// Remove any existing veth devices (before we set up network namespaces)
	cleanupVethLink(originNS)

	// setup network namespace
	ns, err := configureNamespace()
	if err != nil {
		logrus.Fatal(err)
	}

	if err := unshareCmd(ctx, ns, unshareArg); err != nil {
		logrus.Fatal(err)
	}

	connFile, err := vsockConn.File()
	if err != nil {
		logrus.Fatal(err)
	}

	vmSwitchCmd := configureVMSwitch(
		ctx,
		ns,
		vmSwitchLogFile,
		vmSwitchPath,
		tapIface,
		subnet,
		tapDeviceMacAddr,
		connFile)

	if err := vmSwitchCmd.Start(); err != nil {
		logrus.Fatalf("could not start the vm-switch process: %v", err)
	}
	logrus.Infof("successfully started the vm-switch running with a PID: %v", vmSwitchCmd.Process.Pid)

	err = createVethPair(defaultNamespacePID,
		vmSwitchCmd.Process.Pid,
		defaultNSVeth,
		rancherDesktopNSVeth)
	if err != nil {
		logrus.Fatalf("failed to create veth pair: %v", err)
	}
	defer cleanupVethLink(originNS)

	if err := configureVethPair(rancherDesktopNSVeth, "192.168.1.2"); err != nil {
		logrus.Fatalf("failed setting up veth: %s for rancher desktop namespace: %v", rancherDesktopNSVeth, err)
	}

	// switch back to the original namespace to configure veth0
	if err := netns.Set(originNS); err != nil {
		logrus.Fatalf("failed to switch back to original namespace: %v", err)
	}
	if err := configureVethPair(defaultNSVeth, "192.168.1.1"); err != nil {
		logrus.Fatalf("failed setting up veth: %s for rancher desktop namespace: %v", rancherDesktopNSVeth, err)
	}

	if err := originNS.Close(); err != nil {
		logrus.Errorf("failed to close original NS, ignoring error: %v", err)
	}

	if err := vmSwitchCmd.Wait(); err != nil {
		logrus.Errorf("vm-switch exited with error: %v", err)
	}
}

func initializeFlags() {
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
}

func setupLogging(logFile string) {
	if err := log.SetOutputFile(logFile, logrus.StandardLogger()); err != nil {
		logrus.Fatalf("setting logger's output file failed: %v", err)
	}

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}
}

func configureVMSwitch(
	ctx context.Context,
	ns netns.NsHandle,
	vmSwitchLogFile,
	vmSwitchPath,
	tapIface,
	subnet,
	tapDevMacAddr string,
	connFile *os.File) *exec.Cmd {
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
		tapDevMacAddr,
	}
	if vmSwitchLogFile != "" {
		args = append(args, "-logfile", vmSwitchLogFile)
	}
	if debug {
		args = append(args, "-debug")
	}
	vmSwitchCmd := exec.CommandContext(ctx, nsenter, args...)

	// pass in the vsock connection as a FD to the
	// vm-switch process in the newly created namespace
	vmSwitchCmd.ExtraFiles = []*os.File{connFile}
	return vmSwitchCmd
}

func createVethPair(defaultNsPid, peerNsPid int, defaultNSVeth, rancherDesktopNSVeth string) error {
	veth := &netlink.Veth{
		LinkAttrs: netlink.LinkAttrs{
			Name:      defaultNSVeth,
			Namespace: netlink.NsPid(defaultNsPid),
		},
		PeerName:      rancherDesktopNSVeth,
		PeerNamespace: netlink.NsPid(peerNsPid),
	}
	if err := netlink.LinkAdd(veth); err != nil {
		return fmt.Errorf("failed to add veth link %+v: %w", veth, err)
	}
	logrus.Infof("created veth pair %s and %s", defaultNSVeth, rancherDesktopNSVeth)
	return nil
}

// Tear down the veth in the default namespace if it exists; normally
// this should happen when the network namespace goes away.
func cleanupVethLink(originNS netns.NsHandle) {
	// First, though, switch back to the default namespace if available.
	// This would fail if we already switched to it (and closed the handle).
	_ = netns.Set(originNS)
	if link, err := netlink.LinkByName(defaultNSVeth); err == nil {
		err = netlink.LinkDel(link)
		logrus.Infof("tearing down link %s: %v", defaultNSVeth, err)
	}
}

func configureVethPair(vethName, ipAddr string) error {
	veth, err := netlink.LinkByName(vethName)
	if err != nil {
		return err
	}

	vethIP := net.IPNet{
		IP:   net.ParseIP(ipAddr),
		Mask: net.CIDRMask(cidrOnes, cidrBits),
	}

	addr := &netlink.Addr{IPNet: &vethIP, Label: ""}
	if err := netlink.AddrAdd(veth, addr); err != nil {
		return err
	}

	if err := netlink.LinkSetUp(veth); err != nil {
		return err
	}
	return nil
}

func unshareCmd(ctx context.Context, ns netns.NsHandle, args string) error {
	unshareCmd := exec.CommandContext( //nolint:gosec // no security concern with the potentially tainted command arguments
		ctx,
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

func listenForHandshake(ctx context.Context) {
	logrus.Info("starting handshake process with host-switch")
	l, err := vsock.Listen(vsock.CIDAny, vsockHandshakePort)
	if err != nil {
		logrus.Error(err)
	}
	defer l.Close()
	go func() {
		<-ctx.Done()
		l.Close()
	}()
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

		// verify that the host-switch is ready for us to establish the connection
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
