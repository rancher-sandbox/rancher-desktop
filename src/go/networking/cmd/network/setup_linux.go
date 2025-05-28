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

// Command setup-network initializes the network namespace created by the
// systemd unit `network-namespace.service` and forwards traffic.
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
	"reflect"
	"runtime"
	"strconv"

	"github.com/coreos/go-systemd/v22/dbus"
	"github.com/linuxkit/virtsock/pkg/vsock"
	"github.com/sirupsen/logrus"
	"github.com/vishvananda/netlink"
	"github.com/vishvananda/netns"
	"golang.org/x/sys/unix"

	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/log"
	rdvsock "github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/vsock"
)

var options struct {
	debug            bool
	vmSwitchPath     string
	unshareArg       string
	vmSwitchLogFile  string
	dhcpScript       string
	logFile          string
	namespaceService string
	tapIface         string
	subnet           string
	tapDeviceMacAddr string
}

const (
	nsenter                 = "/usr/bin/nsenter"
	unshare                 = "/usr/bin/unshare"
	vsockHandshakePort      = 6669
	vsockDialPort           = 6656
	defaultTapDevice        = "eth0"
	WSLVeth                 = "veth-rd-wsl"
	WSLVethIP               = "192.168.143.2"
	namespaceVeth           = "veth-rd-ns"
	namespaceVethIP         = "192.168.143.1"
	defaultNamespaceService = "network-namespace.service"
	defaultNamespacePID     = 1
	cidrOnes                = 24
	cidrBits                = 32
	stdout                  = "/dev/stdout"
)

func run() error {
	initializeFlags()

	if err := setupLogging(options.logFile); err != nil {
		return err
	}

	if options.vmSwitchPath == "" {
		return fmt.Errorf("path to the vm-switch process must be provided")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), unix.SIGTERM, unix.SIGHUP, unix.SIGQUIT)
	defer cancel()

	originNS, err := netns.Get()
	if err != nil {
		return fmt.Errorf("failed getting a handle to the current namespace: %w", err)
	}

	// Remove any existing veth devices (before we set up network namespaces)
	cleanupVethLink(originNS)

	// listenForHandshake blocks until a successful handshake is established.
	if err := listenForHandshake(ctx); err != nil {
		return fmt.Errorf("failed to handshake with host-switch: %w", err)
	}

	logrus.Debugf("attempting to connect to the host on CID: %v and Port: %d", vsock.CIDHost, vsockDialPort)
	vsockConn, err := vsock.Dial(vsock.CIDHost, vsockDialPort)
	if err != nil {
		return err
	}
	logrus.Debugf("successful connection to host on CID: %v and Port: %d: connection: %+v", vsock.CIDHost, vsockDialPort, vsockConn)

	connFile, err := vsockConn.File()
	if err != nil {
		return err
	}

	// Ensure we stay on the same OS thread so that we don't switch namespaces
	// accidentally.  This must happen before we change any namespaces.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	var peerNS netns.NsHandle
	if os.Getenv("SYSTEMD_EXEC_PID") != "" {
		// Running under systemd
		if options.unshareArg != "" {
			logrus.Warnf("Using systemd, ignoring --unshare-arg=%q", options.unshareArg)
		}

		namespacePID, err := getNamespacePID(ctx)
		if err != nil {
			return err
		}

		peerNS, err = netns.GetFromPid(namespacePID)
		if err != nil {
			return fmt.Errorf("failed to get network namespace: %w", err)
		}
	} else {
		// Running under OpenRC
		if options.unshareArg == "" {
			return fmt.Errorf("unshare program arg must be provided")
		}

		peerNS, err = configureNamespace()
		if err != nil {
			return err
		}

		if err := unshareCmd(ctx, peerNS, options.unshareArg); err != nil {
			return err
		}
	}

	err = createVethPair(
		originNS,
		peerNS,
		WSLVeth,
		namespaceVeth)
	if err != nil {
		return fmt.Errorf("failed to create veth pair: %w", err)
	}
	defer cleanupVethLink(originNS)

	if err := configureVethPair(WSLVeth, WSLVethIP); err != nil {
		return fmt.Errorf("failed setting up veth %q for default namespace: %w", WSLVeth, err)
	}

	// Enter the network namespace to set up its network interface, and to run
	// vm-switch.  We will only switch back to the default namespace on teardown
	// after this point.
	if err := netns.Set(peerNS); err != nil {
		return fmt.Errorf("failed to set network namespace: %w", err)
	}
	if err := configureVethPair(namespaceVeth, namespaceVethIP); err != nil {
		return fmt.Errorf("failed to set up veth %q for Rancher Desktop namespace: %w", namespaceVeth, err)
	}

	logrus.Debug("Starting vm-switch...")

	vmSwitchCmd := configureVMSwitch(
		ctx,
		options.vmSwitchLogFile,
		options.vmSwitchPath,
		options.tapIface,
		options.subnet,
		options.tapDeviceMacAddr,
		options.dhcpScript,
		connFile)
	if err := vmSwitchCmd.Start(); err != nil {
		return fmt.Errorf("vm-switch failed to start: %w", err)
	}

	// Use vmSwitchCmd.Start() + Run() so we can get better messages about whether
	// the start failed or if it started then exited.

	if err := vmSwitchCmd.Wait(); err != nil {
		return fmt.Errorf("vm-switch exited with error: %w", err)
	}

	return nil
}

func main() {
	if err := run(); err != nil {
		logrus.Fatal(err)
	}
}

func initializeFlags() {
	flag.BoolVar(&options.debug, "debug", false, "enable additional debugging")
	flag.StringVar(&options.namespaceService, "namespace-service", defaultNamespaceService, "systemd service which creates the network namespace")
	flag.StringVar(&options.tapIface, "tap-interface", defaultTapDevice, "tap interface name, eg. eth0, eth1")
	flag.StringVar(&options.subnet, "subnet", config.DefaultSubnet,
		fmt.Sprintf("Subnet range with CIDR suffix that is associated to the tap interface, e,g: %s", config.DefaultSubnet))
	flag.StringVar(&options.tapDeviceMacAddr, "tap-mac-address", config.TapDeviceMacAddr,
		"MAC address that is associated to the tap interface")
	flag.StringVar(&options.dhcpScript, "dhcp-script", "", "script to run on DHCP events")
	flag.StringVar(&options.vmSwitchPath, "vm-switch-path", "", "the path to the vm-switch binary that will run in a new namespace")
	flag.StringVar(&options.vmSwitchLogFile, "vm-switch-logfile", "", "path to the logfile for vm-switch process")
	flag.StringVar(&options.unshareArg, "unshare-arg", "", "the command argument to pass to the unshare program")
	flag.StringVar(&options.logFile, "logfile", "/var/log/network-setup.log", "path to the logfile for network setup process")
	flag.Parse()
}

func setupLogging(logFile string) error {
	if logFile == stdout {
		// Use the stdout handle instead of `/dev/stdout` because the latter does
		// not work correctly inside a systemd service.
		logrus.StandardLogger().SetOutput(os.Stdout)
	} else {
		if err := log.SetOutputFile(logFile, logrus.StandardLogger()); err != nil {
			return fmt.Errorf("setting logger's output file failed: %w", err)
		}
	}

	if options.debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	return nil
}

// Set up the vm-switch process, but do not start it.  This is run from the same
// network namespace as the current process.
func configureVMSwitch(
	ctx context.Context,
	vmSwitchLogFile,
	vmSwitchPath,
	tapIface,
	subnet,
	tapDevMacAddr,
	dhcpScript string,
	connFile *os.File) *exec.Cmd {
	args := []string{
		vmSwitchPath,
		"-tap-interface",
		tapIface,
		"-subnet",
		subnet,
		"-tap-mac-address",
		tapDevMacAddr,
		"-dhcp-script",
		dhcpScript,
	}
	if vmSwitchLogFile != "" {
		args = append(args, "-logfile", vmSwitchLogFile)
	}
	if options.debug {
		args = append(args, "-debug")
	}

	//nolint:gosec // Arguments are ultimately controlled by our configs.
	vmSwitchCmd := exec.CommandContext(ctx, args[0], args[1:]...)
	vmSwitchCmd.Stdout = os.Stdout
	vmSwitchCmd.Stderr = os.Stderr

	// Pass in the vsock connection as a FD to the vm-switch process.
	vmSwitchCmd.ExtraFiles = []*os.File{connFile}
	return vmSwitchCmd
}

func createVethPair(defaultNS, peerNS netns.NsHandle, defaultNSVeth, rancherDesktopNSVeth string) error {
	veth := &netlink.Veth{
		LinkAttrs: netlink.LinkAttrs{
			Name:      defaultNSVeth,
			Namespace: netlink.NsFd(defaultNS),
		},
		PeerName:      rancherDesktopNSVeth,
		PeerNamespace: netlink.NsFd(peerNS),
	}
	if err := netlink.LinkAdd(veth); err != nil {
		return fmt.Errorf("failed to add veth link %+v: %w", veth, err)
	}
	logrus.Infof("created veth pair %s and %s", defaultNSVeth, rancherDesktopNSVeth)
	return nil
}

// Switch to the given (default) namespace, and tear down the veth if it exists.
// Normally this should happen when the network namespace goes away.
func cleanupVethLink(originNS netns.NsHandle) {
	// First, though, switch back to the default namespace if available.
	// This would fail if we already switched to it (and closed the handle).
	_ = netns.Set(originNS)
	if link, err := netlink.LinkByName(WSLVeth); err == nil {
		err = netlink.LinkDel(link)
		logrus.Infof("tearing down link %s: %v", WSLVeth, err)
	}
}

// Configure the address of the given network interface.  The interface must
// be visible in the current network namespace.
func configureVethPair(vethName, ipAddr string) error {
	veth, err := netlink.LinkByName(vethName)
	if err != nil {
		return fmt.Errorf("failed to get link %s: %w", vethName, err)
	}

	vethIP := net.IPNet{
		IP:   net.ParseIP(ipAddr),
		Mask: net.CIDRMask(cidrOnes, cidrBits),
	}

	addr := &netlink.Addr{IPNet: &vethIP, Label: ""}
	if err := netlink.AddrAdd(veth, addr); err != nil {
		return fmt.Errorf("failed to add addr %s to %s: %w", addr, vethName, err)
	}

	if err := netlink.LinkSetUp(veth); err != nil {
		return fmt.Errorf("failed to set up link %s: %w", vethName, err)
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

	writePermission := 0o600
	err := os.WriteFile("/run/wsl-init.pid", []byte(unsharePID), fs.FileMode(writePermission))
	if err != nil {
		return err
	}
	return nil
}

func listenForHandshake(ctx context.Context) error {
	logrus.Info("starting handshake process with host-switch")
	l, err := vsock.Listen(vsock.CIDAny, vsockHandshakePort)
	if err != nil {
		return fmt.Errorf("failed to listen on handshake port: %w", err)
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
	return nil
}

// Create a new network namespace, and return the new handle.
// The thread will be left in the original namespace.
func configureNamespace() (ns netns.NsHandle, err error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	oldNS, err := netns.Get()
	if err != nil {
		return netns.None(), err
	}
	defer func() {
		if err2 := netns.Set(oldNS); err == nil && err2 != nil {
			err = err2
		}
	}()
	ns, err = netns.New()
	if err != nil {
		return netns.None(), fmt.Errorf("creating new namespace failed: %w", err)
	}

	logrus.Infof("created a new namespace %v %v", ns, ns.String())
	return ns, nil
}

// Find the PID of the systemd unit `network-namespace.service` and return it.
func getNamespacePID(ctx context.Context) (int, error) {
	conn, err := dbus.NewSystemConnectionContext(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to connect to systemd system bus: %w", err)
	}
	defer conn.Close()
	prop, err := conn.GetServicePropertyContext(ctx, options.namespaceService, "MainPID")
	if err != nil {
		return 0, fmt.Errorf("failed to get namespace service %s main pid: %w", options.namespaceService, err)
	}
	pid, ok := prop.Value.Value().(uint32)
	if !ok {
		fmt.Printf("debug: prop is %+v (%v)", prop.Value.Value(), reflect.ValueOf(prop.Value.Value()))
		return 0, fmt.Errorf("failed to look up main pid of service %s: got value %+v", options.namespaceService, prop)
	}
	return int(pid), nil
}
