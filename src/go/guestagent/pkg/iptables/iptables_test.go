/*
Copyright © 2024 SUSE LLC
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

package iptables_test

import (
	"context"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/docker/go-connections/nat"
	limaIptables "github.com/lima-vm/lima/pkg/guestagent/iptables"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/iptables"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
	"github.com/stretchr/testify/require"
)

func TestForwardPorts(t *testing.T) {
	tests := []struct {
		name                       string
		remove                     bool
		listenerIP                 net.IP
		expectedEntries            []limaIptables.Entry
		expectedEntriesAfterRemove []limaIptables.Entry
		expectedAddFuncErr         error
	}{
		{
			name:       "With localhost listener and valid port mappings",
			listenerIP: net.IPv4(127, 0, 0, 1),
			expectedEntries: []limaIptables.Entry{
				{TCP: true, IP: net.IPv4(192, 168, 20, 10), Port: 1080},
				{TCP: true, IP: net.IPv4(192, 168, 20, 11), Port: 1081},
				{TCP: true, IP: net.IPv4(192, 168, 20, 12), Port: 1082},
			},
		},
		{
			name:       "With wildcard listener and valid port mappings",
			listenerIP: net.IPv4(0, 0, 0, 0),
			expectedEntries: []limaIptables.Entry{
				{TCP: true, IP: net.IPv4(192, 168, 21, 10), Port: 1080},
				{TCP: true, IP: net.IPv4(192, 168, 21, 11), Port: 1081},
				{TCP: true, IP: net.IPv4(192, 168, 21, 12), Port: 1082},
			},
		},
		{
			name:       "With entries removed",
			remove:     true,
			listenerIP: net.IPv4(0, 0, 0, 0),
			expectedEntries: []limaIptables.Entry{
				{TCP: true, IP: net.IPv4(192, 168, 22, 10), Port: 1080},
				{TCP: true, IP: net.IPv4(192, 168, 22, 11), Port: 1081},
				{TCP: true, IP: net.IPv4(192, 168, 22, 12), Port: 1082},
				{TCP: true, IP: net.IPv4(192, 168, 22, 13), Port: 1083},
				{TCP: true, IP: net.IPv4(192, 168, 22, 14), Port: 1084},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			iptablesScanner := fakeScanner{
				expectedEntries: tt.expectedEntries,
				expectedErr:     tt.expectedAddFuncErr,
			}

			testTracker := fakeTracker{
				receivedID:          make(chan string),
				receivedRemoveID:    make(chan string),
				receivedPortMapping: make(chan nat.PortMap),
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			interval := time.Second
			iptablesHandler := iptables.New(ctx, &testTracker, &iptablesScanner, tt.listenerIP, interval)

			go func() {
				require.NoError(t, iptablesHandler.ForwardPorts())
				cancel()
			}()

			for i := 0; i < len(tt.expectedEntries); i++ {
				id := <-testTracker.receivedID
				expectedID := utils.GenerateID(entryToString(tt.expectedEntries[i]))
				require.Equal(t, expectedID, id)

				pm := <-testTracker.receivedPortMapping
				portProto, err := nat.NewPort("tcp", strconv.Itoa(tt.expectedEntries[i].Port))
				require.NoError(t, err)

				expectedPortBinding := nat.PortBinding{
					HostIP:   tt.listenerIP.String(),
					HostPort: strconv.Itoa(tt.expectedEntries[i].Port),
				}
				require.Contains(t, pm[portProto], expectedPortBinding)
			}

			if tt.remove {
				removedEntries := []limaIptables.Entry{
					{TCP: true, IP: net.IPv4(192, 168, 22, 11), Port: 1081},
					{TCP: true, IP: net.IPv4(192, 168, 22, 12), Port: 1082},
				}
				// update the entries
				updatedEntries := []limaIptables.Entry{
					{TCP: true, IP: net.IPv4(192, 168, 22, 10), Port: 1080},
					{TCP: true, IP: net.IPv4(192, 168, 22, 13), Port: 1083},
					{TCP: true, IP: net.IPv4(192, 168, 22, 14), Port: 1084},
					{TCP: true, IP: net.IPv4(192, 168, 22, 15), Port: 1085},
				}
				iptablesScanner.expectedEntries = updatedEntries

				for i := 0; i < len(removedEntries); i++ {
					id := <-testTracker.receivedRemoveID
					expectedID := utils.GenerateID(entryToString(removedEntries[i]))
					require.Equal(t, expectedID, id)
				}

				addedElement := updatedEntries[len(updatedEntries)-1]
				id := <-testTracker.receivedID
				expectedID := utils.GenerateID(entryToString(addedElement))
				require.Equal(t, expectedID, id)

				pm := <-testTracker.receivedPortMapping
				portProto, err := nat.NewPort("tcp", strconv.Itoa(addedElement.Port))
				require.NoError(t, err)

				expectedPortMap := nat.PortMap{
					portProto: []nat.PortBinding{
						{
							HostIP:   tt.listenerIP.String(),
							HostPort: strconv.Itoa(addedElement.Port),
						},
					},
				}
				require.ElementsMatch(t, pm[portProto], expectedPortMap[portProto])
			}
		})
	}
}

func TestForwardPortsSamePortDifferentIP(t *testing.T) {
	duplicatedPort := 1084
	tests := []struct {
		name               string
		listenerIP         net.IP
		expectedEntries    []limaIptables.Entry
		expectedAddFuncErr error
	}{
		{
			name:       "Same Port with different IP",
			listenerIP: net.IPv4(0, 0, 0, 0),
			expectedEntries: []limaIptables.Entry{
				{TCP: true, IP: net.IPv4(192, 168, 22, 10), Port: 1080},
				{TCP: true, IP: net.IPv4(192, 168, 22, 11), Port: 1081},
				{TCP: true, IP: net.IPv4(192, 168, 22, 12), Port: 1082},
				{TCP: true, IP: net.IPv4(192, 168, 22, 13), Port: 1083},
				{TCP: true, IP: net.IPv4(192, 168, 22, 14), Port: duplicatedPort},
				{TCP: true, IP: net.IPv4(192, 168, 22, 15), Port: duplicatedPort},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			iptablesScanner := fakeScanner{
				expectedEntries: tt.expectedEntries,
				expectedErr:     tt.expectedAddFuncErr,
			}

			testTracker := fakeTracker{
				receivedID:          make(chan string),
				receivedRemoveID:    make(chan string),
				receivedPortMapping: make(chan nat.PortMap),
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			interval := time.Second
			iptablesHandler := iptables.New(ctx, &testTracker, &iptablesScanner, tt.listenerIP, interval)

			go func() {
				require.NoError(t, iptablesHandler.ForwardPorts())
				cancel()
			}()

			for i := 0; i < len(tt.expectedEntries); i++ {
				id := <-testTracker.receivedID
				expectedID := utils.GenerateID(entryToString(tt.expectedEntries[i]))
				require.Equal(t, expectedID, id)

				pm := <-testTracker.receivedPortMapping
				portProto, err := nat.NewPort("tcp", strconv.Itoa(tt.expectedEntries[i].Port))
				require.NoError(t, err)

				// Port bindings for the same port on different IP addresses should appear only once
				// in the port mapping. This is because the HostIP is always controlled by the
				// k8sServiceListenerAddr, which means that duplicate entries with the same port
				// but different IPs are unnecessary and should not be handled.
				if tt.expectedEntries[i].Port == duplicatedPort {
					require.Len(t, pm[portProto], 1)
				}

				expectedPortBinding := nat.PortBinding{
					HostIP:   tt.listenerIP.String(),
					HostPort: strconv.Itoa(tt.expectedEntries[i].Port),
				}
				require.Contains(t, pm[portProto], expectedPortBinding)
			}
		})
	}
}

// Fake Tracker implementation for mocking behavior
type fakeTracker struct {
	receivedID          chan string
	receivedRemoveID    chan string
	receivedPortMapping chan nat.PortMap
	expectedAddFuncErr  error
}

func (f *fakeTracker) Get(containerID string) nat.PortMap {
	return nil
}

func (f *fakeTracker) Add(containerID string, portMapping nat.PortMap) error {
	f.receivedID <- containerID
	f.receivedPortMapping <- portMapping
	return f.expectedAddFuncErr
}

func (f *fakeTracker) Remove(containerID string) error {
	f.receivedRemoveID <- containerID
	return nil
}

func (f *fakeTracker) RemoveAll() error {
	return nil
}

// Fake Scanner to simulate iptables entries
type fakeScanner struct {
	expectedEntries []limaIptables.Entry
	expectedErr     error
}

func (f *fakeScanner) GetPorts() ([]limaIptables.Entry, error) {
	return f.expectedEntries, f.expectedErr
}

// Utility function to convert iptables entry to string
func entryToString(ip limaIptables.Entry) string {
	return net.JoinHostPort(ip.IP.String(), strconv.Itoa(ip.Port))
}
