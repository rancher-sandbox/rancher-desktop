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

/*
Package procnet provides functionality to scan and manage network ports based on the system's
/proc/net/{tcp,udp} entries. It monitors for new and removed ports and handles port forwarding
via host switch's API. Also, it creates iptables PREROUTING rules, specifically for containers
using the host network driver. This package is designed to work with the Linux-based WSL
environment, enabling localnet routing and managing port mappings.
*/
package procnet

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/procnettcp"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

type action string

const (
	Append action = "append"
	Delete action = "delete"
)

const routeLocalnet = "/proc/sys/net/ipv4/conf/eth0/route_localnet"

type ProcNetScanner struct {
	context       context.Context
	LocalnetRoute bool
	tracker       tracker.Tracker
	scanInterval  time.Duration
}

func NewProcNetScanner(ctx context.Context, tracker tracker.Tracker, scanInterval time.Duration) (*ProcNetScanner, error) {
	return &ProcNetScanner{
		context:      ctx,
		tracker:      tracker,
		scanInterval: scanInterval,
	}, enableLocalnetRouting()
}

func (p *ProcNetScanner) ForwardPorts() error {
	ticker := time.NewTicker(p.scanInterval)
	defer ticker.Stop()

	var previousPortMap nat.PortMap

	for {
		select {
		case <-p.context.Done():
			return fmt.Errorf("/proc/net scanner context cancelled: %w", p.context.Err())
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
					log.Infof("/proc/net scanner added port: %s -> %+v", port, bindings)
					err := p.tracker.Add(utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port())), nat.PortMap{
						port: bindings,
					})
					if err != nil {
						log.Errorf("/proc/net scanner failed to add port: %s", err)
						continue
					}
					if err = p.execLoopbackIPtablesRule(bindings, port, Append); err != nil {
						log.Errorf("/proc/net scanner creating loopback iptable rules for portbinding: %v failed: %s", bindings, err)
					}
				}
			}

			// Remove old ports
			for port, previousBindings := range previousPortMap {
				if _, exists := newPortMap[port]; !exists {
					log.Infof("/proc/net scanner removed port: %s -> %+v", port, previousBindings)
					err := p.tracker.Remove(utils.GenerateID(fmt.Sprintf("%s/%s", port.Proto(), port.Port())))
					if err != nil {
						log.Errorf("/proc/net scanner failed to remove port: %s", err)
						continue
					}

					if err = p.execLoopbackIPtablesRule(previousBindings, port, Delete); err != nil {
						log.Errorf("/proc/net scanner deleting loopback iptable rules for portbinding: %v failed: %s", previousBindings, err)
					}
				}
			}

			previousPortMap = newPortMap
		}
	}
}

// execLoopbackIPtablesRule modifies iptables NAT rules to handle loopback traffic for a specified port
// and protocol. This function is only necessary when the container is using the host network driver
// (i.e., with --network=host), as in this case the container shares the host's network namespace.
//
// When using the host network driver, network traffic bound to 127.0.0.1 needs to be redirected from
// outside the network namespace to the localhost (127.0.0.1). This function adds or removes DNAT rules
// that allow traffic to be forwarded to the specified port on localhost, based on the provided 'action'
// ('append' or 'delete').
//
// The function iterates over the provided list of port bindings. For each binding where the HostIP is set
// to 127.0.0.1, it constructs and executes the corresponding iptables command to either add or delete the
// appropriate DNAT rule.
//
// The iptables rule ensures that incoming traffic from outside the network namespace (i.e., from the
// host machine) on the specified port and protocol is redirected to the same port on localhost, where the
// container's service can be accessed.
//
// Example iptables rule when 'action' is "append":
//
//	iptables -t nat -A PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
//
// Example iptables rule when 'action' is "delete":
//
//	iptables -t nat -D PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
func (p *ProcNetScanner) execLoopbackIPtablesRule(bindings []nat.PortBinding, portProto nat.Port, action action) error {
	for _, binding := range bindings {
		if binding.HostIP == "127.0.0.1" {
			// iptables -t nat -D PREROUTING -p tcp --dport 8009 -j DNAT --to-destination 127.0.0.1:8009
			iptablesCmd := exec.CommandContext(p.context,
				"iptables",
				"--table", "nat",
				fmt.Sprintf("--%s", action), "PREROUTING",
				"--protocol", portProto.Proto(),
				"--dport", binding.HostPort,
				"--jump", "DNAT",
				"--to-destination", fmt.Sprintf("%s:%s", binding.HostIP, binding.HostPort),
			)
			if err := iptablesCmd.Run(); err != nil {
				return err
			}
			log.Debugf("running the following iptables rule [%s] for port bindings: %v", iptablesCmd.String(), binding)
		}
	}
	return nil
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
	portMapKey, err := nat.NewPort(strings.ToLower(entry.Kind), port)
	if err != nil {
		return fmt.Errorf("generating portMapKey protocol: %s, port: %d failed: %w",
			entry.Kind,
			entry.Port,
			err)
	}

	// It's important not to use entry.IP directly here, as any IP
	// other than 127.0.0.1 (localhost) or 0.0.0.0 may not be accessible
	// from the host. To ensure consistent behavior, we always set the
	// HostIP to INADDR_ANY (0.0.0.0) unless the IP is localhost or 0.0.0.0.
	// The API tracker will then adjust the address as necessary:
	// - If admin privileges are enabled, the address will remain 0.0.0.0.
	// - Otherwise, it will be changed to 127.0.0.1 to ensure proper local binding.
	var hostIP net.IP
	inAddrAny := net.IPv4(0, 0, 0, 0)
	if entry.IP.IsLoopback() || entry.IP.Equal(inAddrAny) {
		hostIP = entry.IP
	} else {
		hostIP = inAddrAny
	}
	portBinding := nat.PortBinding{
		HostIP:   hostIP.String(),
		HostPort: port,
	}
	portMap[portMapKey] = append(portMap[portMapKey], portBinding)
	return nil
}

func enableLocalnetRouting() error {
	const enable = "1"
	return writeSysctl(routeLocalnet, enable)
}

func writeSysctl(path string, value string) error {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("could not open the sysctl file %s: %w", path, err)
	}
	defer f.Close()
	if _, err := io.WriteString(f, value); err != nil {
		return fmt.Errorf("could not write to the sysctl file %s: %w", path, err)
	}
	log.Infof("/proc/net scanner enabled %s", routeLocalnet)
	return nil
}
