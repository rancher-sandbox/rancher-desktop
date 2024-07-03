// Package iptables handles forwarding ports found in iptables dnat
package iptables

import (
	"context"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/lima-vm/lima/pkg/guestagent/iptables"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

// ForwardPorts forwards ports found in iptables dnat. In some environments,
// like WSL, ports defined using the CNI portmap plugin happen through iptables.
// These ports are not sent to places like /proc/net/tcp and are not picked up
// as part of the normal forwarding system. This function detects those ports
// and binds them so that they are picked up.
// The argument is a time, in seconds, to wait between updating.
func ForwardPorts(ctx context.Context, tracker tracker.Tracker, updateInterval time.Duration) error {
	var ports []iptables.Entry

	for {
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
				time.Sleep(updateInterval)

				continue
			}

			return err
		}

		log.Debugf("found ports %+v", newPorts)

		// Diff from existing forwarded ports
		added, removed := comparePorts(ports, newPorts)
		ports = newPorts

		// Remove old forwards
		for _, p := range removed {
			name := entryToString(p)
			if err := tracker.RemoveListener(ctx, p.IP, p.Port); err != nil {
				log.Warnf("failed to close listener %q: %w", name, err)
			}
		}

		// Add new forwards
		for _, p := range added {
			name := entryToString(p)
			if err := tracker.AddListener(ctx, p.IP, p.Port); err != nil {
				log.Errorf("failed to listen %q: %w", name, err)
			} else {
				log.Infof("opened listener for %q", name)
			}
		}

		select {
		case <-ctx.Done():
			return nil
		default: // continue the loop
		}

		// Wait for next loop
		time.Sleep(updateInterval)
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
