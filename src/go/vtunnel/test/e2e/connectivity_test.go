//go:build windows
// +build windows

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

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/config"
)

var (
	wslTarballName = "distro-0.21.tar"
	wslTarballURL  = "https://github.com/rancher-sandbox/rancher-desktop-wsl-distro/releases/download/v0.21/distro-0.21.tar"
	wslDistroName  = "vtunnel-e2e-test"
	handShakePort  = 9090
	handShakePort2 = 9091
	vSockHostPort  = 8989
	vSockHostPort2 = 9999
	peerTCPPort    = 3030
	peerTCPPort2   = 4040
	configFile     = "config.yaml"
)

func TestConnect(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, configFile)

	t.Log("Building vtunnel host binary")
	err := buildBinaries("../../main.go", "windows", tmpDir)
	require.NoError(t, err, "Failed building vtunnel.exe")

	t.Log("Building vtunnel peer binary")
	err = buildBinaries("../../main.go", "linux", tmpDir)
	require.NoError(t, err, "Failed building vtunnel")

	t.Logf("Dowloading %v wsl distro tarball", wslTarballName)
	tarballPath := filepath.Join(tmpDir, wslTarballName)

	err = downloadFile(tarballPath, wslTarballURL)
	require.NoErrorf(t, err, "Failed to download wsl distro tarball %v", wslTarballName)

	t.Logf("Creating %v wsl distro", wslDistroName)
	installCmd := cmdExec(
		tmpDir,
		"wsl",
		"--import",
		wslDistroName,
		".",
		tarballPath)
	err = installCmd.Run()
	require.NoErrorf(t, err, "Failed to install distro %v", wslDistroName)

	defer func() {
		t.Logf("Deleting %v wsl distro", wslDistroName)
		err := cmdExec("", "wsl", "--unregister", wslDistroName).Run()
		require.NoErrorf(t, err, "Failed to unregister distro %v", wslDistroName)
	}()

	// It takes a long time to start a new distro,
	// 20 sec is a long time but that's actually how long
	// it takes to start a distro without any flakiness
	timeout := time.Second * 20
	tryInterval := time.Second * 2
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
	require.NoErrorf(t, err, "Failed to check if %v wsl distro is running", wslDistroName)

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
				HandshakePort:         uint32(handShakePort),
				VsockHostPort:         uint32(vSockHostPort),
				PeerAddress:           "127.0.0.1",
				PeerPort:              peerTCPPort,
				UpstreamServerAddress: testHTTPServerAddr,
			},
			{
				HandshakePort:         uint32(handShakePort2),
				VsockHostPort:         uint32(vSockHostPort2),
				PeerAddress:           "127.0.0.1",
				PeerPort:              peerTCPPort2,
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
		"--configPath", configFile)
	err = peerCmd.Start()
	require.NoError(t, err, "Starting vtunnel peer process faild")
	defer func() {
		_ = peerCmd.Process.Kill()
	}()

	t.Log("Starting vtunnel host process")
	vtunHostPath := filepath.Join(tmpDir, "main.exe")
	hostCmd := cmdExec(
		tmpDir,
		vtunHostPath, "host",
		"--configPath", configFile)

	err = hostCmd.Start()
	require.NoError(t, err, "Starting vtunnel host process faild")
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

	t.Logf("Sending a request to vtunnel peer process in [%v] over: 127.0.0.1:%v", wslDistroName, peerTCPPort)
	peerAddr1 := fmt.Sprintf("127.0.0.1:%v", peerTCPPort)
	out, err := cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "curl", "--verbose", "--fail-with-body", peerAddr1)
	require.NoError(t, err, "Failed sending request to vtunnel peer process")
	require.Contains(t, out, "vtunnel host 1 called.")

	t.Logf("Sending a request to vtunnel peer process in [%v] over: 127.0.0.1:%v", wslDistroName, peerTCPPort2)
	peerAddr2 := fmt.Sprintf("127.0.0.1:%v", peerTCPPort2)
	out, err = cmdRunWithOutput("wsl", "--distribution", wslDistroName, "--exec", "curl", "--verbose", "--fail-with-body", peerAddr2)
	require.NoError(t, err, "Failed sending request to vtunnel peer process")
	require.Contains(t, out, "vtunnel host 2 called.")
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
