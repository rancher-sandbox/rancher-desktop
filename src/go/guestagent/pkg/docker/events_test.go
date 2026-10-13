// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package docker

import (
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/stretchr/testify/assert"

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
