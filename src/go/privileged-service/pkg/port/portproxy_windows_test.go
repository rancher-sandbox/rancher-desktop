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

package port

import (
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
)

func TestGetHash(t *testing.T) {
	wslConnectAddrs := []types.ConnectAddrs{{Network: "tcp", Addr: "192.168.0.1"}}
	ports1 := portProxy{
		PortMap: nat.PortMap{
			"443/tcp": []nat.PortBinding{
				{
					HostIP:   "192.168.0.10",
					HostPort: "443",
				},
			},
		},
		ConnectAddrs: wslConnectAddrs,
	}

	ports2 := portProxy{
		PortMap: nat.PortMap{
			"443/tcp": []nat.PortBinding{
				{
					HostIP:   "192.168.0.10",
					HostPort: "443",
				},
			},
		},
		ConnectAddrs: wslConnectAddrs,
	}

	ports3 := portProxy{
		PortMap: nat.PortMap{
			"80/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.2",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.3",
					HostPort: "80",
				},
			},
		},
		ConnectAddrs: wslConnectAddrs,
	}

	ports4 := portProxy{
		PortMap: nat.PortMap{
			"80/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.2",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.3",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.1",
					HostPort: "80",
				},
			},
		},
		ConnectAddrs: wslConnectAddrs,
	}

	ports5 := portProxy{
		PortMap: nat.PortMap{
			"80/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: "80",
				},
			},
		},
		ConnectAddrs: []types.ConnectAddrs{
			{Network: "tcp", Addr: "192.168.0.1"},
			{Network: "tcp", Addr: "192.168.0.2"},
			{Network: "tcp", Addr: "192.168.0.3"},
		},
	}

	ports6 := portProxy{
		PortMap: nat.PortMap{
			"80/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: "80",
				},
			},
		},
		ConnectAddrs: []types.ConnectAddrs{
			{Network: "tcp", Addr: "192.168.0.2"},
			{Network: "tcp", Addr: "192.168.0.1"},
			{Network: "tcp", Addr: "192.168.0.3"},
		},
	}

	ports7 := portProxy{
		PortMap: nat.PortMap{
			"443/tcp": []nat.PortBinding{
				{
					HostIP:   "192.168.0.10",
					HostPort: "443",
				},
			},
		},
		ConnectAddrs: wslConnectAddrs,
	}

	ports8 := portProxy{
		PortMap: nat.PortMap{
			"443/tcp": []nat.PortBinding{
				{
					HostIP:   "192.168.0.11",
					HostPort: "443",
				},
			},
		},
		ConnectAddrs: wslConnectAddrs,
	}
	ports9 := portProxy{
		PortMap: nat.PortMap{
			"80/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.2",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.3",
					HostPort: "80",
				},
			},
			"443/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: "443",
				},
				{
					HostIP:   "127.0.0.3",
					HostPort: "443",
				},
				{
					HostIP:   "127.0.0.2",
					HostPort: "443",
				},
			},
		},
		ConnectAddrs: []types.ConnectAddrs{
			{Network: "tcp", Addr: "192.168.0.2"},
			{Network: "tcp", Addr: "192.168.0.1"},
			{Network: "tcp", Addr: "192.168.0.3"},
		},
	}
	ports10 := portProxy{
		PortMap: nat.PortMap{
			"443/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.2",
					HostPort: "443",
				},
				{
					HostIP:   "127.0.0.3",
					HostPort: "443",
				},
				{
					HostIP:   "127.0.0.1",
					HostPort: "443",
				},
			},
			"80/tcp": []nat.PortBinding{
				{
					HostIP:   "127.0.0.2",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.1",
					HostPort: "80",
				},
				{
					HostIP:   "127.0.0.3",
					HostPort: "80",
				},
			},
		},
		ConnectAddrs: []types.ConnectAddrs{
			{Network: "tcp", Addr: "192.168.0.1"},
			{Network: "tcp", Addr: "192.168.0.2"},
			{Network: "tcp", Addr: "192.168.0.3"},
		},
	}

	ports11 := portProxy{
		PortMap:      nil,
		ConnectAddrs: nil,
	}

	ports12 := portProxy{
		PortMap:      nil,
		ConnectAddrs: nil,
	}

	ports13 := portProxy{
		PortMap:      make(nat.PortMap),
		ConnectAddrs: []types.ConnectAddrs{},
	}

	ports14 := portProxy{
		PortMap:      make(nat.PortMap),
		ConnectAddrs: []types.ConnectAddrs{},
	}

	tests := []struct {
		description string
		actual      portProxy
		expect      portProxy
		shouldMatch bool
		expectedErr error
	}{
		{
			description: "simple objects",
			actual:      ports1,
			expect:      ports2,
			shouldMatch: true,
			expectedErr: nil,
		},
		{
			description: "When port maps are not in the same order",
			actual:      ports3,
			expect:      ports4,
			shouldMatch: true,
			expectedErr: nil,
		},
		{
			description: "When connect Addrs are not in the same order",
			actual:      ports5,
			expect:      ports6,
			shouldMatch: true,
			expectedErr: nil,
		},
		{
			description: "When port maps are not the same",
			actual:      ports7,
			expect:      ports8,
			shouldMatch: false,
			expectedErr: nil,
		},
		{
			description: "When port maps keys are not in the same order",
			actual:      ports9,
			expect:      ports10,
			shouldMatch: true,
			expectedErr: nil,
		},
		{
			description: "When both port maps and connect Addrs are nil",
			actual:      ports11,
			expect:      ports12,
			shouldMatch: true,
			expectedErr: nil,
		},
		{
			description: "When both port maps and connect Addrs are empty",
			actual:      ports13,
			expect:      ports14,
			shouldMatch: true,
			expectedErr: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			actualHash, err := getHash(tt.actual)
			if err != tt.expectedErr {
				t.Fatalf("did not expect an error, but got: %s", err)
			}
			expectedHash, err := getHash(tt.expect)
			if err != tt.expectedErr {
				t.Fatalf("did not expect an error, but got: %s", err)
			}
			result := actualHash == expectedHash
			if result != tt.shouldMatch {
				t.Fatalf("%s: expected to match: %s", actualHash, expectedHash)
			}
		})
	}
}
