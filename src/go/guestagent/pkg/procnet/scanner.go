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

// TODO: add package comment
package procnet

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/procnettcp"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

func ForwardPorts(ctx context.Context, tracker tracker.Tracker, scanInterval time.Duration) error {
	ticker := time.NewTicker(scanInterval)
	defer ticker.Stop()

	var previousPortMap nat.PortMap

	for {
		select {
		case <-ctx.Done():
			log.Errorf("Procnet scanner context cancelled: %s", ctx.Err())
			return nil
		case <-ticker.C:
			entries, err := procnettcp.ParseFiles()
			if err != nil {
				log.Errorf("failed to parse /proc/net/{tcp, udp} files: %s", err)
				continue
			}
			newPortMap := make(nat.PortMap)
			for _, entry := range entries {
				if err := addValidProtoEntryToPortMap(entry, newPortMap); err != nil {
					log.Errorf("failed to create portMapping for entry: %w", err)
					continue
				}
			}

			// Add new ports
			for port, bindings := range newPortMap {
				if _, exists := previousPortMap[port]; !exists {
					log.Infof("procnet scanner added port: %s -> %+v", port, bindings)
					err := tracker.Add(generateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port())), nat.PortMap{
						port: bindings,
					})
					if err != nil {
						log.Errorf("procnet scanner faild to add port: %s", err)
					}
				}
			}

			// Remove old ports
			for port, previousBindings := range previousPortMap {
				if _, exists := newPortMap[port]; !exists {
					log.Infof("procnet scanner removed port: %s -> %+v", port, previousBindings)
					err := tracker.Remove(generateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port())))
					if err != nil {
						log.Errorf("procnet scanner faild to remove port: %s", err)
					}
				}
			}

			previousPortMap = newPortMap
		}
	}
}

func addValidProtoEntryToPortMap(entry procnettcp.Entry, portMap nat.PortMap) error {
	switch entry.Kind {
	case procnettcp.TCP:
		if entry.State == procnettcp.TCPListen {
			return addEntryToPortMap(entry, portMap)
		}
	case procnettcp.UDP:
		if entry.State == procnettcp.UDPEstablished {
			return addEntryToPortMap(entry, portMap)
		}
	}
	return nil
}

func addEntryToPortMap(entry procnettcp.Entry, portMap nat.PortMap) error {
	port := strconv.Itoa(int(entry.Port))
	portMapKey, err := nat.NewPort(entry.Kind, port)
	if err != nil {
		return fmt.Errorf("generating portMapKey protocol: %s, port: %d failed: %w", entry.Kind, entry.Port, err)
	}

	// It's important not to use entry.IP directly here, as any IP
	// other than 127.0.0.1 (localhost) or 0.0.0.0 may not be accessible
	// from the host. To ensure consistent behavior, we always set the
	// HostIP to INADDR_ANY (0.0.0.0) unless the IP is localhost or 0.0.0.0.
	// The API tracker will then adjust the address as necessary:
	// - If admin privileges are enabled, the address will remain 0.0.0.0.
	// - Otherwise, it will be changed to 127.0.0.1 to ensure proper local binding.
	var hostIP string
	inAddrAny := net.IPv4(0, 0, 0, 0)
	if entry.IP.IsLoopback() || entry.IP.Equal(inAddrAny) {
		hostIP = entry.IP.String()
	} else {
		hostIP = inAddrAny.String()
	}
	portBinding := nat.PortBinding{
		HostIP:   hostIP,
		HostPort: port,
	}
	if pb, ok := portMap[portMapKey]; ok {
		portMap[portMapKey] = append(pb, portBinding)
	} else {
		portMap[portMapKey] = []nat.PortBinding{portBinding}
	}
	return nil
}

func generateID(entry string) string {
	hasher := sha256.New()
	hasher.Write([]byte(entry))
	return hex.EncodeToString(hasher.Sum(nil))
}
