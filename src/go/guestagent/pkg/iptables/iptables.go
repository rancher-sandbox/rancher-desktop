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
	"crypto/sha256"
	"encoding/hex"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/lima-vm/lima/pkg/guestagent/iptables"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

// ForwardPorts forwards ports found in iptables DNAT. In some environments,
// like WSL, ports defined using the CNI portmap plugin happen through iptables.
// These ports are not sent to places like /proc/net/tcp and are not picked up
// as part of the normal forwarding system. This function detects those ports
// and binds them so that they are picked up.
// The argument is a time, in seconds, to wait between updating.
func ForwardPorts(ctx context.Context, tracker tracker.Tracker, updateInterval time.Duration) error {
	var ports []iptables.Entry

	ticker := time.NewTicker(updateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// Detect ports for forward
			newPorts, err := iptables.GetPorts()
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
			log.Debugf("iptable found ports %+v", newPorts)

			// Diff from existing forwarded ports
			added, removed := comparePorts(ports, newPorts)
			ports = newPorts

			// Remove old forwards
			for _, p := range removed {
				name := entryToString(p)
				if err := tracker.Remove(generateID(name)); err != nil {
					log.Warnf("failed to close listener %q: %w", name, err)
				}
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
						// We can set the hostIP to INADDR_ANY the API Tracker will determine
						// the admin installation and can adjust this to localhost accordingly
						HostIP:   "0.0.0.0",
						HostPort: port,
					}
					if pb, ok := portMap[portMapKey]; ok {
						portMap[portMapKey] = append(pb, portBinding)
					} else {
						portMap[portMapKey] = []nat.PortBinding{portBinding}
					}
					name := entryToString(p)
					if err := tracker.Add(generateID(name), portMap); err != nil {
						log.Errorf("failed to listen %q: %w", name, err)
					} else {
						log.Infof("opened listener for %q", name)
					}
				}
			}
		case <-ctx.Done():
			return nil
		}
	}
}

// comparePorts compares the old and new ports to find those added or removed.
// This function is mostly lifted from lima (github.com/lima-vm/lima) which is
// licensed under the Apache 2.
//
//nolint:nonamedreturns
func comparePorts(oldPorts, newPorts []iptables.Entry) (added, removed []iptables.Entry) {
	mRaw := make(map[string]iptables.Entry, len(oldPorts))
	mStillExist := make(map[string]bool, len(oldPorts))
	for _, f := range oldPorts {
		k := entryToString(f)
		mRaw[k] = f
		mStillExist[k] = false
	}
	for _, f := range newPorts {
		k := entryToString(f)
		mStillExist[k] = true
		if _, ok := mRaw[k]; !ok {
			added = append(added, f)
		}
	}
	for k, stillExist := range mStillExist {
		if !stillExist {
			if x, ok := mRaw[k]; ok {
				removed = append(removed, x)
			}
		}
	}
	return
}

func entryToString(ip iptables.Entry) string {
	return net.JoinHostPort(ip.IP.String(), strconv.Itoa(ip.Port))
}

func generateID(entry string) string {
	hasher := sha256.New()
	hasher.Write([]byte(entry))
	return hex.EncodeToString(hasher.Sum(nil))
}
