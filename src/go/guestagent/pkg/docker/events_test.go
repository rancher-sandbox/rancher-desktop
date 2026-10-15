// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package docker

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	containerapi "github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/go-connections/nat"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/ports"
)

func TestPortMapFromDocker(t *testing.T) {
	dockerPorts := nat.PortMap{
		"80/tcp":   {{HostIP: "127.0.0.1", HostPort: "8080"}, {HostIP: "::1", HostPort: "8080"}},
		"53/udp":   {{HostIP: "0.0.0.0", HostPort: "5353"}},
		"9000/tcp": nil,
	}
	want := ports.PortMap{
		"80/tcp":   {{HostIP: "127.0.0.1", HostPort: "8080"}, {HostIP: "::1", HostPort: "8080"}},
		"53/udp":   {{HostIP: "0.0.0.0", HostPort: "5353"}},
		"9000/tcp": {},
	}
	assert.Equal(t, want, portMapFromDocker(dockerPorts))
}

func TestStopDeletesEveryLoopbackRule(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the fake iptables is a shell script")
	}
	tests := []struct {
		name     string
		ports    nat.PortMap
		networks map[string]*network.EndpointSettings
	}{
		{
			name: "two ports on one network",
			ports: nat.PortMap{
				"6379/tcp": {{HostIP: "127.0.0.1", HostPort: "22579"}},
				"6380/tcp": {{HostIP: "127.0.0.1", HostPort: "22580"}},
			},
			networks: map[string]*network.EndpointSettings{
				"app_default": {IPAddress: "10.4.0.22"},
			},
		},
		{
			name: "one port on two networks",
			ports: nat.PortMap{
				"6379/tcp": {{HostIP: "127.0.0.1", HostPort: "22579"}},
			},
			networks: map[string]*network.EndpointSettings{
				"app_default": {IPAddress: "10.4.0.22"},
				"app_backend": {IPAddress: "10.5.0.22"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			binDir := t.TempDir()
			logPath := filepath.Join(t.TempDir(), "iptables.log")
			t.Setenv("IPTABLES_LOG", logPath)
			script := "#!/bin/sh\necho \"$*\" >> \"$IPTABLES_LOG\"\n"
			require.NoError(t, os.WriteFile(filepath.Join(binDir, "iptables"), []byte(script), 0o755))
			// PATH holds only the fake iptables, so no test run can reach the host's rules.
			t.Setenv("PATH", binDir)

			readLog := func() []string {
				data, err := os.ReadFile(logPath)
				require.NoError(t, err)
				return strings.Split(strings.TrimSpace(string(data)), "\n")
			}

			const containerID = "c0ffee"
			e := &EventMonitor{iptablesRulesToDelete: make(map[string][]*exec.Cmd)}
			container := containerapi.InspectResponse{
				ContainerJSONBase: &containerapi.ContainerJSONBase{ID: containerID},
				NetworkSettings:   &containerapi.NetworkSettings{Networks: tt.networks},
			}
			e.createIptablesRuleForContainer(t.Context(), container, portMapFromDocker(tt.ports))

			startLines := readLog()
			var expected []string
			for _, line := range startLines {
				if strings.Contains(line, "--append DOCKER") {
					expected = append(expected, strings.Replace(line, "--append", "--delete", 1))
				}
			}
			require.Len(t, expected, 2)

			e.deleteLoopbackIPtablesRules(containerID)
			assert.ElementsMatch(t, expected, readLog()[len(startLines):])
		})
	}
}
