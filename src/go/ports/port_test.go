// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package ports

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNewPort(t *testing.T) {
	for _, tc := range []struct {
		proto, port string
		want        Port
	}{
		{"tcp", "80", "80/tcp"},
		{"udp", "053", "53/udp"},
		{"tcp", "0", "0/tcp"},
		{"tcp", "65535", "65535/tcp"},
	} {
		got, err := NewPort(tc.proto, tc.port)
		if err != nil || got != tc.want {
			t.Errorf("NewPort(%q, %q) = %q, %v; want %q", tc.proto, tc.port, got, err, tc.want)
		}
	}
	for _, port := range []string{"", "-1", "65536", "http", "80-90"} {
		if got, err := NewPort("tcp", port); err == nil {
			t.Errorf("NewPort(%q, %q) = %q; want an error", "tcp", port, got)
		}
	}
}

func TestPortProtoAndPort(t *testing.T) {
	for _, tc := range []struct {
		port        Port
		proto, want string
	}{
		{"80/tcp", "tcp", "80"},
		{"53/udp", "udp", "53"},
		{"8080", "tcp", "8080"},
	} {
		if got := tc.port.Proto(); got != tc.proto {
			t.Errorf("Port(%q).Proto() = %q; want %q", tc.port, got, tc.proto)
		}
		if got := tc.port.Port(); got != tc.want {
			t.Errorf("Port(%q).Port() = %q; want %q", tc.port, got, tc.want)
		}
	}
}

func TestParsePort(t *testing.T) {
	for raw, want := range map[string]int{"": 0, "443": 443, "65535": 65535} {
		got, err := ParsePort(raw)
		if err != nil || got != want {
			t.Errorf("ParsePort(%q) = %d, %v; want %d", raw, got, err, want)
		}
	}
	for _, raw := range []string{"-1", "65536", "http"} {
		if got, err := ParsePort(raw); err == nil {
			t.Errorf("ParsePort(%q) = %d; want an error", raw, got)
		}
	}
}

// TestPortMappingJSON pins the wire format that the README documents.
func TestPortMappingJSON(t *testing.T) {
	mapping := PortMapping{
		Remove: true,
		Ports: PortMap{
			"80/tcp": {{HostIP: "127.0.0.1", HostPort: "8080"}, {HostIP: "::1", HostPort: "8080"}},
			"53/udp": {{HostIP: "0.0.0.0", HostPort: "5353"}},
		},
		ConnectAddrs: []ConnectAddrs{{Network: "tcp", Addr: "192.0.2.1:25"}},
	}
	wire := `{"remove":true,"ports":{"53/udp":[{"HostIp":"0.0.0.0","HostPort":"5353"}],` +
		`"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"},{"HostIp":"::1","HostPort":"8080"}]},` +
		`"connectAddrs":[{"network":"tcp","addr":"192.0.2.1:25"}]}`

	encoded, err := json.Marshal(mapping)
	if err != nil || string(encoded) != wire {
		t.Errorf("json.Marshal() = %s, %v; want %s", encoded, err, wire)
	}
	var decoded PortMapping
	if err := json.Unmarshal([]byte(wire), &decoded); err != nil || !reflect.DeepEqual(decoded, mapping) {
		t.Errorf("json.Unmarshal() = %+v, %v; want %+v", decoded, err, mapping)
	}
}
