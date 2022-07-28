// package iptables handles forwarding ports found in iptables dnat
package iptables

import (
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/lima-vm/lima/pkg/guestagent/iptables"
)

// ForwardPorts forwards ports found in iptables dnat. In some environments,
// like WSL, ports defined using the CNI portmap plugin happen through iptables.
// These ports are not sent to places like /proc/net/tcp and are not picked up
// as part of the normal forwarding system. This function detects those ports
// and binds them so that they are picked up.
// The argument is a time, in seconds, to wait between updating.
func ForwardPorts(t time.Duration) error {
	var ports []iptables.Entry
	var wrappers = make(map[string]*wrapper)

	for {
		// Detect ports for forward
		newports, err := iptables.GetPorts()
		if err != nil {
			// iptables exiting with an exit status of 4 means there
			// is a resource problem. For example, something else is
			// running iptables. In that case, we can skip trying it for
			// this loop. You can find the exit code in the iptables
			// source at https://git.netfilter.org/iptables/tree/include/xtables.h
			if strings.Contains(err.Error(), "exit status 4") {
				log.Debug("iptables exited with status 4 (resource error). Retrying...")
				time.Sleep(t)
				continue
			}

			return err
		}
		log.Debugf("found ports %+v", newports)

		// Diff from existing forwarded ports
		added, removed := comparePorts(ports, newports)
		ports = newports

		// Remove old forwards
		for _, p := range removed {
			name := entryToString(p)
			if w, found := wrappers[name]; found {
				w.Close()
				delete(wrappers, name)
				log.Infof("closed listener for %q", name)
			} else {
				log.Warnf("expected listener for %q not found to close", name)
			}
		}

		// Add new forwards
		for _, p := range added {
			name := entryToString(p)
			if _, found := wrappers[name]; found {
				log.Debugf("adding port: entry already exists for %q", name)
				continue
			}
			w := newWrapper(p)
			wrappers[name] = w
			err := w.Init()
			if err != nil {
				log.Errorf("error initializing %q: %s", name, err)
			}
			log.Infof("opened listener for %q", name)
		}

		// Wait for next loop
		time.Sleep(t)
	}
}

// comparePorts compares the old and new ports to find those added or removed.
// This function is mostly lifted from lima (github.com/lima-vm/lima) which is
// licensed under the Apache 2.
func comparePorts(old, neww []iptables.Entry) (added, removed []iptables.Entry) {
	mRaw := make(map[string]iptables.Entry, len(old))
	mStillExist := make(map[string]bool, len(old))

	for _, f := range old {
		k := entryToString(f)
		mRaw[k] = f
		mStillExist[k] = false
	}
	for _, f := range neww {
		k := entryToString(f)
		if _, ok := mRaw[k]; !ok {
			added = append(added, f)
		}
		mStillExist[k] = true
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

type wrapper struct {
	addr     *net.TCPAddr
	listener *net.TCPListener
}

func newWrapper(ip iptables.Entry) *wrapper {
	return &wrapper{
		addr: &net.TCPAddr{
			IP:   ip.IP,
			Port: ip.Port,
		},
	}
}

// Init initializes the listener that opens the port
func (w *wrapper) Init() error {
	l, err := net.ListenTCP("tcp4", w.addr)
	if err != nil {
		return err
	}
	w.listener = l
	return nil
}

// Close closes the listener
func (w *wrapper) Close() error {
	return w.listener.Close()
}
