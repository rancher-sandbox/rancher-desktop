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

// Package iptables handles forwarding ports found in iptables DNAT
package iptables

import (
	"context"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/iptables"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

// Iptables manages port forwarding for ports identified in iptables DNAT rules.
// It is primarily responsible for handling port mappings in Kubernetes environments that
// are not exposed via the Kubernetes API. The package scans iptables for these port and uses
// the k8sServiceListenerAddr setting for the hostIP property to create a port mapping and
// forwards them to both the API tracker and the WSL Proxy for proper routing and handling.
type Iptables struct {
	context         context.Context
	apiTracker      tracker.Tracker
	IptablesScanner Scanner
	listenerIP      net.IP
	// time, in seconds, to wait between updating.
	updateInterval time.Duration
}

func New(ctx context.Context, tracker tracker.Tracker, iptablesScanner Scanner, listenerIP net.IP, updateInterval time.Duration) *Iptables {
	return &Iptables{
		context:         ctx,
		apiTracker:      tracker,
		IptablesScanner: iptablesScanner,
		listenerIP:      listenerIP,
		updateInterval:  updateInterval,
	}
}

// ForwardPorts forwards ports found in iptables DNAT. In some environments,
// like WSL, ports defined using the CNI portmap plugin happen through iptables.
// These ports are not sent to places like /proc/net/tcp and are not picked up
// as part of the normal forwarding system. This function detects those ports
// and binds them to k8sServiceListenerAddr so that they are picked up.
func (i *Iptables) ForwardPorts() error {
	var ports []iptables.Entry

	ticker := time.NewTicker(i.updateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-i.context.Done():
			return nil
		case <-ticker.C:
		}
		// Detect ports for forward
		newPorts, err := i.IptablesScanner.GetPorts()
		if err != nil {
			// iptables exiting with an exit status of 4 means there
			// is a resource problem. For example, something else is
			// running iptables. In that case, we can skip trying it for
			// this loop. You can find the exit code in the iptables
			// source at https://git.netfilter.org/iptables/tree/include/xtables.h
			if strings.Contains(err.Error(), "exit status 4") {
				log.Debug("iptables exited with status 4 (resource error). Retrying...")
				continue // Retry in the next iteration
			}
			return err
		}

		// Diff from existing forwarded ports
		added, removed := comparePorts(ports, newPorts)
		ports = newPorts

		// Remove old forwards
		for _, p := range removed {
			name := entryToString(p)
			if err := i.apiTracker.Remove(utils.GenerateID(name)); err != nil {
				log.Warnf("iptables scanner failed to remove portmap for %s: %w", name, err)
				continue
			}
			log.Infof("iptables scanner removed portmap for %s", name)
		}

		portMap := make(nat.PortMap)

		// Add new forwards
		for _, p := range added {
			if p.TCP {
				port := strconv.Itoa(p.Port)
				portMapKey, err := nat.NewPort("tcp", port)
				if err != nil {
					log.Errorf("failed to create a corresponding key for the portMap: %s", err)
					continue
				}
				portBinding := nat.PortBinding{
					HostIP:   i.listenerIP.String(),
					HostPort: port,
				}
				if pb, ok := portMap[portMapKey]; ok {
					if !portExist(port, pb) {
						portMap[portMapKey] = append(pb, portBinding)
					}
				} else {
					portMap[portMapKey] = []nat.PortBinding{portBinding}
				}
				name := entryToString(p)
				if err := i.apiTracker.Add(utils.GenerateID(name), portMap); err != nil {
					log.Errorf("iptables scanner failed to forward portmap for %s: %s", name, err)
					continue
				}
				log.Infof("iptables scanner forwarded portmap for %s", name)
			}
		}
	}
}

// portExist checks if the given port is already present in the list of port bindings.
// Since we always use the k8sServiceListenerAddr for the HostIP, the actual IP
// returned by GetPorts is irrelevant, and we only care about whether the HostPort is
// already mapped. This avoids adding duplicate entries to the nat.PortMap.
func portExist(port string, portBindings []nat.PortBinding) bool {
	for _, p := range portBindings {
		if port == p.HostPort {
			return true
		}
	}
	return false
}

// comparePorts compares the old and new ports to find those added or removed.
// This function is mostly lifted from lima (github.com/lima-vm/lima) which is
// licensed under the Apache 2.
//
//nolint:nonamedreturns
func comparePorts(oldPorts, newPorts []iptables.Entry) (added, removed []iptables.Entry) {
	oldPortMap := make(map[string]iptables.Entry, len(oldPorts))
	portExistMap := make(map[string]bool, len(oldPorts))
	for _, oldPort := range oldPorts {
		key := entryToString(oldPort)
		oldPortMap[key] = oldPort
		portExistMap[key] = false
	}
	for _, newPort := range newPorts {
		key := entryToString(newPort)
		portExistMap[key] = true
		if _, ok := oldPortMap[key]; !ok {
			added = append(added, newPort)
		}
	}
	for k, stillExist := range portExistMap {
		if !stillExist {
			if entry, ok := oldPortMap[k]; ok {
				removed = append(removed, entry)
			}
		}
	}
	return
}

func entryToString(ip iptables.Entry) string {
	return net.JoinHostPort(ip.IP.String(), strconv.Itoa(ip.Port))
}
