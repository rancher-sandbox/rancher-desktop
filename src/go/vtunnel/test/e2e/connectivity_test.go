//go:build windows

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

package e2e

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/config"
)

var (
	tarballVersion = "0.27"
	wslTarballName = fmt.Sprintf("distro-%s.tar", tarballVersion)
	wslTarballURL  = fmt.Sprintf(
		"https://github.com/rancher-sandbox/rancher-desktop-wsl-distro/releases/download/v%s/%s",
		tarballVersion,
		wslTarballName)
	wslDistroName = "vtunnel-e2e-test"
	// TCP connect test ports
	handShakePortT  = 9091
	handShakePortT2 = 9092
	vSockHostPortT  = 8989
	vSockHostPortT2 = 9999
	peerTCPPortT    = 3131
	peerTCPPortT2   = 4141
	// Named Pipe connect test ports
	handShakePortN  = 9093
	handShakePortN2 = 9094
	vSockHostPortN  = 8979
	vSockHostPortN2 = 9989
	peerTCPPortN    = 3132
	peerTCPPortN2   = 4142

	configFile    = "config.yaml"
	tryInterval   = time.Second * 2
	nPipeEndpoint = "npipe:////./pipe/vtunnel-e2e"
	tmpDir        string
	configPath    string
)

func TestNamedPipeConnect(t *testing.T) {
	id1, id2 := 1, 2
	nPipeFile1 := fmt.Sprintf("%v-%v-%v", nPipeEndpoint, id1, uuid.New())
	go startNPipeEchoServer(t, nPipeFile1)

	nPipeFile2 := fmt.Sprintf("%v-%v-%v", nPipeEndpoint, id2, uuid.New())
	go startNPipeEchoServer(t, nPipeFile2)

	t.Log("Creating a test config.yaml")

	conf := &config.Config{
		Tunnel: []config.Tunnel{
			{
				HandshakePort:         uint32(handShakePortN),
				VsockHostPort:         uint32(vSockHostPortN),
				PeerAddress:           "127.0.0.1",
				PeerPort:              peerTCPPortN,
				UpstreamServerAddress: nPipeFile1,
			},
			{
				HandshakePort:         uint32(handShakePortN2),
				VsockHostPort:         uint32(vSockHostPortN2),
				PeerAddress:           "127.0.0.1",
				PeerPort:              peerTCPPortN2,
				UpstreamServerAddress: nPipeFile2,
			},
		},
	}

	data, err := yaml.Marshal(conf)
	require.NoError(t, err, "Failed marshaling config into yaml")

	err = os.WriteFile(configPath, data, 0644)
	require.NoError(t, err, "Failed writing config.yaml file")

	t.Logf("Starting vtunnel peer process in wsl [%v]", wslDistroName)
	peerCmd := cmdExec(
		tmpDir,
		"wsl", "--user", "root",
		"--distribution", wslDistroName,
		"--exec", "./main", "peer",
		"--config-path", configFile)

	err = peerCmd.Start()
	require.NoError(t, err, "Starting vtunnel peer process failed")

	defer func() {
		_ = peerCmd.Process.Kill()
	}()

	t.Log("Starting vtunnel host process")
	vtunHostPath := filepath.Join(tmpDir, "main.exe")
	hostCmd := cmdExec(
		tmpDir,
		vtunHostPath, "host",
		"--config-path", configFile)

	err = hostCmd.Start()
	require.NoError(t, err, "Starting vtunnel host process failed")

	defer func() {
		_ = hostCmd.Process.Kill()
	}()

	t.Log("Confirming vtunnel peer process is up")
	peerCmdTimeout := time.Second * 10

	err = confirm(func() bool {
		p, err := os.FindProcess(peerCmd.Process.Pid)
		if err != nil {
			t.Logf("looking for vtunnel peer process PID: %v", err)
			return false
		}
		return p.Pid == peerCmd.Process.Pid
	}, tryInterval, peerCmdTimeout)

	require.NoError(t, err, "failed to confirm vtunnel peer process is running")

	t.Logf("Sending a request to npipe [%v] via vtunnel peer process in [%v] over: 127.0.0.1:%v", nPipeFile1, wslDistroName, peerTCPPortN)
	peerAddr1 := fmt.Sprintf("127.0.0.1:%v", peerTCPPortN)
	out, err := cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "curl", "--http0.9", "--verbose", "--fail-with-body", peerAddr1)
	require.NoError(t, err, "failed sending request to vtunnel peer process")
	require.Contains(t, out, fmt.Sprintf("vtunnel named pipe %v called.", nPipeFile1))

	t.Logf("Sending a request to npipe [%v] via vtunnel peer process in [%v] over: 127.0.0.1:%v", nPipeFile2, wslDistroName, peerTCPPortN2)
	peerAddr2 := fmt.Sprintf("127.0.0.1:%v", peerTCPPortN2)
	out, err = cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "curl", "--http0.9", "--verbose", "--fail-with-body", peerAddr2)
	require.NoError(t, err, "failed sending request to vtunnel peer process")
	require.Contains(t, out, fmt.Sprintf("vtunnel named pipe %v called.", nPipeFile2))
}

func TestTCPConnect(t *testing.T) {
	ts := startHTTPServer(1)
	testHTTPServerAddr := strings.TrimPrefix(ts.URL, "http://")

	ts2 := startHTTPServer(2)
	testHTTPServerAddr2 := strings.TrimPrefix(ts2.URL, "http://")

	defer ts.Close()
	t.Logf("Started a test HTTP server in the host machine listening on [%v]", testHTTPServerAddr)

	t.Log("Creating a test config.yaml")
	conf := &config.Config{
		Tunnel: []config.Tunnel{
			{
				HandshakePort:         uint32(handShakePortT),
				VsockHostPort:         uint32(vSockHostPortT),
				PeerAddress:           "127.0.0.1",
				PeerPort:              peerTCPPortT,
				UpstreamServerAddress: testHTTPServerAddr,
			},
			{
				HandshakePort:         uint32(handShakePortT2),
				VsockHostPort:         uint32(vSockHostPortT2),
				PeerAddress:           "127.0.0.1",
				PeerPort:              peerTCPPortT2,
				UpstreamServerAddress: testHTTPServerAddr2,
			},
		},
	}

	data, err := yaml.Marshal(conf)
	require.NoError(t, err, "Failed marshaling config into yaml")

	err = os.WriteFile(configPath, data, 0644)
	require.NoError(t, err, "Failed writing config.yaml file")

	t.Logf("Starting vtunnel peer process in wsl [%v]", wslDistroName)
	peerCmd := cmdExec(
		tmpDir,
		"wsl", "--user", "root",
		"--distribution", wslDistroName,
		"--exec", "./main", "peer",
		"--config-path", configFile)

	err = peerCmd.Start()
	require.NoError(t, err, "Starting vtunnel peer process failed")

	defer func() {
		_ = peerCmd.Process.Kill()
	}()

	t.Log("Starting vtunnel host process")
	vtunHostPath := filepath.Join(tmpDir, "main.exe")
	hostCmd := cmdExec(
		tmpDir,
		vtunHostPath, "host",
		"--config-path", configFile)

	err = hostCmd.Start()
	require.NoError(t, err, "Starting vtunnel host process failed")
	defer func() {
		_ = hostCmd.Process.Kill()
	}()

	t.Log("Confirming vtunnel peer process is up")
	peerCmdTimeout := time.Second * 10
	err = confirm(func() bool {
		p, err := os.FindProcess(peerCmd.Process.Pid)
		if err != nil {
			t.Logf("looking for vtunnel peer process PID: %v", err)
			return false
		}
		return p.Pid == peerCmd.Process.Pid
	}, tryInterval, peerCmdTimeout)
	require.NoError(t, err, "failed to confirm vtunnel peer process is running")

	t.Logf("Sending a request to vtunnel peer process in [%v] over: 127.0.0.1:%v", wslDistroName, peerTCPPortT)
	peerAddr1 := fmt.Sprintf("127.0.0.1:%v", peerTCPPortT)
	out, err := cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "curl", "--verbose", "--fail-with-body", peerAddr1)
	require.NoError(t, err, "Failed sending request to vtunnel peer process")
	require.Contains(t, out, "vtunnel host 1 called.")

	t.Logf("Sending a request to vtunnel peer process in [%v] over: 127.0.0.1:%v", wslDistroName, peerTCPPortT2)
	peerAddr2 := fmt.Sprintf("127.0.0.1:%v", peerTCPPortT2)
	out, err = cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "curl", "--verbose", "--fail-with-body", peerAddr2)
	require.NoError(t, err, "Failed sending request to vtunnel peer process")
	require.Contains(t, out, "vtunnel host 2 called.")
}

func TestMain(m *testing.M) {
	var err error
	tmpDir, err = os.MkdirTemp("", "vtunnel-e2e-test")
	requireNoErrorf(err, "Failed to create a temp directory")
	defer os.RemoveAll(tmpDir)

	configPath = filepath.Join(tmpDir, configFile)

	logrus.Info("Building vtunnel host binary")
	err = buildBinaries("../../main.go", "windows", tmpDir)
	requireNoErrorf(err, "Failed building vtunnel.exe")

	logrus.Info("Building vtunnel peer binary")
	err = buildBinaries("../../main.go", "linux", tmpDir)
	requireNoErrorf(err, "Failed building vtunnel")

	tarballPath := filepath.Join(os.TempDir(), wslTarballName)
	_, err = os.Stat(tarballPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			err = downloadFile(tarballPath, wslTarballURL)
			requireNoErrorf(err, "Failed to download wsl distro tarball %v", wslTarballName)
		}
		requireNoErrorf(err, "Failed to retrieve file info for %v", tarballPath)
	}

	logrus.Infof("Creating %v wsl distro", wslDistroName)
	// wsl --import <Distro> <InstallLocation> <FileName> --version 2
	err = cmdExec(
		tmpDir,
		"wsl",
		"--import",
		wslDistroName,
		".",
		tarballPath,
		"--version",
		"2").Run()
	requireNoErrorf(err, "Failed to install distro %v", wslDistroName)

	// It takes a long time to start a new distro,
	// 20 sec is a long time but that's actually how long
	// it takes to start a distro without any flakiness
	timeout := time.Second * 20
	err = confirm(func() bool {
		// Run `wslpath` to see if the distribution is registered; this avoids
		// parsing the output of `wsl --list` to avoid having to handle UTF-16.
		out, err := cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "/bin/wslpath", ".")
		if err != nil {
			return false
		}
		// We expect `wslpath` to output a single dot for the given command.
		return strings.TrimSpace(out) == "."
	}, tryInterval, timeout)
	requireNoErrorf(err, "Failed to check if %v wsl distro is running", wslDistroName)

	// run test
	code := m.Run()

	logrus.Infof("Deleting %v wsl distro", wslDistroName)
	err = cmdExec("", "wsl", "--unregister", wslDistroName).Run()
	requireNoErrorf(err, "Failed to unregister distro %v", wslDistroName)

	os.Exit(code)
}

func startNPipeEchoServer(t *testing.T, uri string) {
	t.Logf("starting a named pipe server listening on: %v", uri)
	l, err := winio.ListenPipe(uri[len("npipe://"):], nil)
	require.NoError(t, err, "Failed to listen on named pipe: %v", nPipeEndpoint)
	for {
		c, err := l.Accept()
		if err != nil {
			require.NoError(t, err, "accepting incoming named pipe connection: %w")
		}
		_, err = c.Write([]byte(fmt.Sprintf("vtunnel named pipe %v called.", uri)))
		require.NoError(t, err, "Failed to write to named pipe: %v", nPipeEndpoint)
		// allow a bit of time before closing the connection immediately
		// so downstream can completed conn exchange
		time.Sleep(time.Second * 2)
		c.Close()
	}
}

func startHTTPServer(id int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "vtunnel host %v called.", id)
	}))
}

func confirm(command func() bool, interval, timeout time.Duration) error {
	tick := time.NewTicker(interval)
	terminate := time.After(timeout)

	for {
		select {
		case <-tick.C:
			if command() {
				return nil
			}
		case <-terminate:
			return fmt.Errorf("Failed to run within %v", timeout)
		}
	}
}

func buildBinaries(path, goos, tmpDir string) error {
	buildCmd := exec.Command("go", "build", "-o", tmpDir, path)
	buildCmd.Env = append(os.Environ(), fmt.Sprintf("GOOS=%s", goos))
	buildCmd.Stdout = os.Stdout
	buildCmd.Stderr = os.Stderr

	return buildCmd.Run()
}

func cmdRunWithOutput(command string, args ...string) (string, error) {
	var outBuf, errBuf bytes.Buffer
	cmd := exec.Command(command, args...)
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	err := cmd.Run()
	if err != nil {
		return errBuf.String(), err
	}
	return outBuf.String(), nil
}

func cmdExec(execDir, command string, args ...string) *exec.Cmd {
	cmd := exec.Command(command, args...)
	if execDir != "" {
		cmd.Dir = execDir
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd
}

func downloadFile(path, url string) error {
	logrus.Infof("Dowloading %v wsl distro tarball", wslTarballName)
	resp, err := http.Get(url) // nolint:gosec // wsl-distro release URL
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, resp.Body); err != nil {
		return err
	}
	return nil
}

func requireNoErrorf(err error, format string, args ...interface{}) {
	if err != nil {
		logrus.Fatalf(format, args...)
	}
}
