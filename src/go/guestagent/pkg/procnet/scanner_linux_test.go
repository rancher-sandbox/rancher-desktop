/*
Copyright © 2026 SUSE LLC
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

package procnet

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	guestagentTypes "github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

func TestDnatChainContainsPort(t *testing.T) {
	const cniSinglePort = `Chain CNI-HOSTPORT-DNAT (1 references)
target     prot opt source               destination
CNI-DN-040d482914fc21368006e  tcp  --  0.0.0.0/0            0.0.0.0/0            /* dnat name: "bridge" id: "default-abc" */ multiport dports 8080
`

	const cniMultiplePorts = `Chain CNI-HOSTPORT-DNAT (1 references)
target     prot opt source               destination
CNI-DN-aaaaaaaaaaaaaaaaaaaaaaaa  tcp  --  0.0.0.0/0            0.0.0.0/0            /* dnat name: "bridge" id: "default-aaa" */ multiport dports 80,8080,8443
`

	const dockerChain = `Chain DOCKER (2 references)
target     prot opt source               destination
RETURN     all  --  0.0.0.0/0            0.0.0.0/0
DNAT       tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:80 to:172.17.0.2:80
`

	const onlyHeader = `Chain CNI-HOSTPORT-DNAT (0 references)
target     prot opt source               destination
`

	// Pitfall: ports that also appear as IP octets. Searching for 80 must
	// not match "10.4.0.80", and searching for 8000 must not match
	// "to:...:8000" -- the regex anchors on dport, not on the destination.
	const ipOctetLooksLikePort = `Chain DOCKER (1 references)
target     prot opt source               destination
DNAT       tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:9000 to:10.4.0.80:8000
`

	// UDP rule with the same port number as a TCP probe: must NOT match.
	// This is the cross-protocol failure mode the engineChainManagesPort
	// protocol parameter exists to prevent.
	const udpOnlyChain = `Chain DOCKER (1 references)
target     prot opt source               destination
DNAT       udp  --  0.0.0.0/0            0.0.0.0/0            udp dpt:53 to:172.17.0.2:53
`

	// Both TCP and UDP rules on the same port in the same chain. A TCP
	// probe matches the TCP line; a UDP probe matches the UDP line.
	const tcpAndUdpSamePort = `Chain DOCKER (2 references)
target     prot opt source               destination
DNAT       udp  --  0.0.0.0/0            0.0.0.0/0            udp dpt:53 to:172.17.0.2:53
DNAT       tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:53 to:172.17.0.3:53
`

	// Port-range form `tcp dpts:LO:HI` is intentionally not matched; the
	// engines RD ships emit per-port rules. Lock the current behavior so
	// any future range-matching support is a deliberate change.
	const tcpRangeChain = `Chain DOCKER (1 references)
target     prot opt source               destination
DNAT       tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpts:8000:9000 to:127.0.0.1
`

	// Multiport with an embedded range: `dports 80,1000:2000,3000`.
	// The regex captures up to the first colon, so 80 and 1000 match but
	// 1500 (inside the range) and 3000 (after the range) do not.
	const multiportEmbeddedRange = `Chain CNI-HOSTPORT-DNAT (1 references)
target     prot opt source               destination
CNI-DN-aaaaaaaaaaaaaaaaaaaaaaaa  tcp  --  0.0.0.0/0            0.0.0.0/0            multiport dports 80,1000:2000,3000
`

	tests := []struct {
		name     string
		output   string
		protocol string
		port     string
		want     bool
	}{
		{"empty output", "", "tcp", "8080", false},
		{"chain header only", onlyHeader, "tcp", "8080", false},

		{"single CNI dport matches exact", cniSinglePort, "tcp", "8080", true},
		{"single CNI dport does not match prefix 80", cniSinglePort, "tcp", "80", false},
		{"single CNI dport does not match unrelated 8081", cniSinglePort, "tcp", "8081", false},
		{"single CNI dport does not match suffix 080", cniSinglePort, "tcp", "080", false},

		{"multiport list matches first entry", cniMultiplePorts, "tcp", "80", true},
		{"multiport list matches middle entry", cniMultiplePorts, "tcp", "8080", true},
		{"multiport list matches last entry", cniMultiplePorts, "tcp", "8443", true},
		{"multiport list does not match unrelated 8000", cniMultiplePorts, "tcp", "8000", false},

		{"DOCKER dpt: matches", dockerChain, "tcp", "80", true},
		{"DOCKER dpt: does not match unrelated 8080", dockerChain, "tcp", "8080", false},

		{"IP octet 10.4.0.80 does not match port 80", ipOctetLooksLikePort, "tcp", "80", false},
		{"destination port :8000 does not match port 8000", ipOctetLooksLikePort, "tcp", "8000", false},
		{"dpt:9000 still matches port 9000", ipOctetLooksLikePort, "tcp", "9000", true},

		{"udp rule does not match tcp probe on same port", udpOnlyChain, "tcp", "53", false},
		{"udp rule matches udp probe on same port", udpOnlyChain, "udp", "53", true},
		{"tcp probe matches tcp line in mixed chain", tcpAndUdpSamePort, "tcp", "53", true},
		{"udp probe matches udp line in mixed chain", tcpAndUdpSamePort, "udp", "53", true},
		{"multiport with tcp probe does not match unrelated udp", cniMultiplePorts, "udp", "80", false},

		{"dpts:8000:9000 does not match port 8500 (range form unsupported)", tcpRangeChain, "tcp", "8500", false},
		{"dpts:8000:9000 does not match port 8000 (range form unsupported)", tcpRangeChain, "tcp", "8000", false},

		{"multiport with embedded range matches pre-range single 80", multiportEmbeddedRange, "tcp", "80", true},
		{"multiport with embedded range matches pre-range single 1000", multiportEmbeddedRange, "tcp", "1000", true},
		{"multiport with embedded range does not match port inside range 1500", multiportEmbeddedRange, "tcp", "1500", false},
		{"multiport with embedded range does not match port after range 3000", multiportEmbeddedRange, "tcp", "3000", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, dnatChainContainsPort(tt.output, tt.protocol, tt.port))
		})
	}
}

func TestIsIptablesRuleAbsent(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"non-exit error", errors.New("fork failure"), false},
		{
			"missing chain",
			&exec.ExitError{Stderr: []byte("iptables: No chain/target/match by that name.\n")},
			true,
		},
		{
			"missing rule",
			&exec.ExitError{Stderr: []byte("iptables: Bad rule (does a matching rule exist in that chain?).\n")},
			true,
		},
		{
			"xtables lock contention",
			&exec.ExitError{Stderr: []byte("Another app is currently holding the xtables lock; still 1s 0us time ahead to have a chance to grab the lock...\n")},
			false,
		},
		{
			"unrelated stderr",
			&exec.ExitError{Stderr: []byte("iptables v1.8.11: invalid port/service `99999' specified\n")},
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, isIptablesRuleAbsent(tt.err))
		})
	}
}

// TestPortAlreadyExposedSubstringIsReachable pins the substring contract
// that the procnet delegation path depends on. The substring originates
// in gvisor-tap-vsock's host-port forwarder; the response body passes
// through forwarder.verifyResponseBody ("%w: %s" wrap of ErrAPI), then
// through tracker.APITracker.Add ("%w: %+v" wrap of ErrExposeAPI). If
// either wrap layer ever drops the body, or upstream renames the
// message, this test fails before the procnet scanner silently regresses.
func TestPortAlreadyExposedSubstringIsReachable(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/services/forwarder/expose", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("host port forwarding: cannot expose 127.0.0.1:8080: proxy already running"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	tr := tracker.NewAPITracker(context.Background(), &noopForwarder{}, srv.URL, "192.168.127.2", true)

	port, err := nat.NewPort("tcp", "8080")
	require.NoError(t, err)
	addErr := tr.Add("synthetic-tcp-8080", nat.PortMap{
		port: []nat.PortBinding{{HostIP: "127.0.0.1", HostPort: "8080"}},
	})
	require.Error(t, addErr)
	require.Contains(t, addErr.Error(), portAlreadyExposedSubstring,
		"the delegation marker must survive the forwarder/tracker wrap chain")
}

type noopForwarder struct{}

func (noopForwarder) Send(_ guestagentTypes.PortMapping) error { return nil }
