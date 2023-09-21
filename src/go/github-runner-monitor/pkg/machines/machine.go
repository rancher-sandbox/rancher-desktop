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

package machines

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"time"

	"github.com/kata-containers/kata-containers/src/runtime/pkg/govmm/qemu"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"
)

// getDefault returns the default value if the first value is empty.
func getDefault(value, defaultValue string) string {
	if value != "" {
		return value
	}
	return defaultValue
}

// Run a new machine with the given configuration.  When the machine shuts down,
// the returned channel will be closed.
func Run(ctx context.Context, c Config) (<-chan struct{}, error) {
	log := logrus.WithField("machine", c.Name)

	// Set up a qemu QMP control channel, so that we can try to terminate the
	// machine gracefully on shut down.  We do this by creating a randomly named
	// unix socket, which we can pass to qemu.
	qmpPath, err := os.CreateTemp("", "github-runner-qemu-*.sock")
	if err != nil {
		return nil, fmt.Errorf("failed to create temporary qemu socket: %w", err)
	}
	qmpPath.Close()
	if err = os.Remove(qmpPath.Name()); err != nil {
		return nil, fmt.Errorf("failed to remove temporary qemu socket: %w", err)
	}
	qmpListener, err := net.ListenUnix("unix", &net.UnixAddr{Name: qmpPath.Name()})
	if err != nil {
		return nil, fmt.Errorf("failed to listen on unix socket: %w", err)
	}
	defer qmpListener.Close()
	qmpFile, err := qmpListener.File()
	if err != nil {
		return nil, fmt.Errorf("failed to get unix listener file: %w", err)
	}
	defer os.Remove(qmpFile.Name())

	// Manually build arguments for qemu.  We don't use the kata arg builders
	// because we want some custom flags (e.g. -snapshot), and the bulk of our
	// flags never change (just sub in memory sizes etc.).
	qemuArgs := []string{
		"-name", c.Name,
		// "Q35" machine, try to use hardware acceleration
		"-machine", "q35,accel=kvm:hvf:tcg",
		// Use host CPU to allow virtualization.
		"-cpu", "host",
		"-smp", getDefault(c.Cpus, "2"),
		"-m", getDefault(c.Memory, "16G"),
		"-numa", "node,memdev=dimm1",
		"-object", fmt.Sprintf("memory-backend-ram,id=dimm1,size=%s", getDefault(c.Memory, "16G")),
		"-device", "virtio-balloon-pci,id=balloon1,deflate-on-oom=off,disable-modern=false",
		// Disk descriptions. The disk is used as a snapshot (no writing changes).
		"-device", "virtio-blk-pci,disable-modern=false,drive=vda,scsi=off,config-wce=off,serial=vda",
		"-drive", fmt.Sprintf("id=vda,file=%s,aio=io_uring,format=qcow2,if=none", c.Disk),
		"-snapshot",
		// Create network explicitly. Use user-mode to avoid dealing with setup.
		"-nic", "user,model=virtio-net-pci",
		// Pass in qemu control socket; it's always 3 (after stdin/stdout/stderr).
		"-qmp", "unix:fd=3,server=on",
		// Set up VNC for debugging, but have it look for a free port automatically.
		"-display", "none", "-vnc", ":0,to=9999",
		// Expose GitHub runner configuration
		"-fw_cfg", fmt.Sprintf("name=opt/github-jit-config,string=%s", c.JitConfig),
	}

	qmpLog := &LogAdapter{log}
	chProcessDone := make(chan struct{})
	procCtx, cancel := context.WithCancel(ctx)
	created := false
	attr := &unix.SysProcAttr{Setpgid: true} // Set PGID, so it doesn't receive Ctrl+C
	cmd, stderr, err := qemu.LaunchCustomQemu(ctx, "", qemuArgs, []*os.File{qmpFile}, attr, qmpLog)
	if err != nil {
		cancel()
		return nil, err
	}
	qmpFile.Close() // Close the QMP server, since qemu has it now

	// Signal when the process exits.
	go func() {
		if state, err := cmd.Process.Wait(); err != nil {
			log.WithError(err).Error("Failed to wait for process.")
		} else if !state.Success() {
			log.Errorf("Process exited with %s", state.String())
		}
		close(chProcessDone)
		cancel()
	}()
	// Copy the output from qemu to the logs in the background.
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			log.Infof("%s", scanner.Text())
		}
		if err := scanner.Err(); err != nil {
			log.WithError(err).Error("Error reading stderr")
		}
	}()

	defer func() {
		if !created {
			killProcess(cmd, chProcessDone, log)
		}
	}()

	// Now that the process is running, hook up the QMP channel.
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: qmpPath.Name()})
	if err != nil {
		return nil, fmt.Errorf("failed to establish connection for qmp: %w", err)
	}

	qmp, version, err := qemu.QMPStartWithConn(procCtx, conn, qemu.QMPConfig{Logger: qmpLog}, make(chan struct{}))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to qmp: %w", err)
	}
	log.Tracef("Connected to QMP %d.%d.%d: %+v", version.Major, version.Minor, version.Micro, version.Capabilities)

	if err = qmp.ExecuteQMPCapabilities(procCtx); err != nil {
		log.WithError(err).Error("failed to get capabilities")
		// Don't care about the failure other than to log it
	}

	// Set a custom function that will be called when procCtx is closed.
	cmd.Cancel = func() error {
		log.Info("Gracefully shutting down, this may take a while...")
		timeoutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := qmp.ExecuteSystemPowerdown(timeoutCtx); err != nil {
			log.WithError(err).Error("Failed to power down")
		}
		cancel()
		killProcess(cmd, chProcessDone, log)
		log.Trace("Machine shut down complete")
		return os.ErrProcessDone
	}

	log.Trace("Machine created")
	created = true

	return chProcessDone, nil
}

// killProcess kills the given command gracefully, with a timeout.  The given
// channel is expected to be closed when the command exits.
func killProcess(cmd *exec.Cmd, chProcessDone <-chan struct{}, log logrus.FieldLogger) {
	proc := cmd.Process
	if proc == nil {
		return
	}
	if err := proc.Signal(unix.SIGTERM); err != nil {
		log.WithError(err).Error("Failed to terminate process")
		if err = proc.Kill(); err != nil {
			log.WithError(err).Error("Failed to kill process; orphaning.")
		}
		return
	}
	select {
	case <-chProcessDone:
		return
	case <-time.After(30 * time.Second):
		log.Warn("Time out waiting for process exit, force killing")
		if err := proc.Kill(); err != nil {
			log.WithError(err).Error("Failed to kill process; orphaning.")
		}
	}
}
