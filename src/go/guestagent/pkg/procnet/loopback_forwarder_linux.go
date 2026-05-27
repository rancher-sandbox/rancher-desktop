/*
Copyright © 2026 SUSE LLC
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
*/

// loopbackForwarder runs a userspace TCP/UDP proxy inside the container
// engine's network namespace. For each 127.0.0.1 listener procnet
// observes (--network=host containers), it opens a matching listener on
// bindIP -- the tap-interface IP that gvisor-tap-vsock host-switch
// already routes to -- and pipes accepted connections to
// 127.0.0.1:<port>.
//
// This replaces the PREROUTING DNAT rule procnet previously wrote into
// the nat table. Both paths bridge eth0-arriving traffic to the
// engine-internal loopback, but userspace forwarding lives outside the
// nat table, so it cannot collide with CNI-HOSTPORT-DNAT or DOCKER.
// Userspace forwarding removes the engine-chain probing surface that
// #10280 added.
//
// TCP mirrors Lima's pkg/portfwd/listener.go. UDP delegates to
// gvisor-tap-vsock's forwarder.UDPProxy, the same code Lima uses for
// its UDP path in pkg/portfwd/client.go.

package procnet

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/containers/gvisor-tap-vsock/pkg/services/forwarder"
)

const (
	protoTCP = "tcp"
	protoUDP = "udp"
)

type loopbackForwarder struct {
	bindIP net.IP
	dialer net.Dialer

	mu  sync.Mutex
	tcp map[string]net.Listener
	udp map[string]*forwarder.UDPProxy
}

func newLoopbackForwarder(bindIP net.IP) *loopbackForwarder {
	return &loopbackForwarder{
		bindIP: bindIP,
		tcp:    make(map[string]net.Listener),
		udp:    make(map[string]*forwarder.UDPProxy),
	}
}

func key(proto string, port uint16) string {
	return proto + "/" + strconv.Itoa(int(port))
}

// Add opens a userspace forwarder for proto/port. Repeated Adds for
// the same key are idempotent. The caller must call Remove when the
// upstream listener disappears.
//
// EADDRINUSE on the bind step propagates as a plain listen error.
// The scanner's publish path rolls back the tracker entry and retries
// each tick; the per-port log-once flag bounds the noise on a
// persistent collision. The mixed-binding case (a host-network
// container holding both 127.0.0.1:port and 0.0.0.0:port) no longer
// reaches this path: the scanner skips Add when the bindings include
// a wildcard entry, since the wildcard listener already accepts
// bindIP:port directly. The remaining EADDRINUSE trigger is an
// unrelated process inside the engine namespace holding bindIP:port.
func (f *loopbackForwarder) Add(ctx context.Context, proto string, port uint16) error {
	k := key(proto, port)
	f.mu.Lock()
	defer f.mu.Unlock()

	switch proto {
	case protoTCP:
		if _, ok := f.tcp[k]; ok {
			return nil
		}
		lis, err := net.ListenTCP(protoTCP, &net.TCPAddr{IP: f.bindIP, Port: int(port)})
		if err != nil {
			return fmt.Errorf("listen %s: %w", k, err)
		}
		f.tcp[k] = lis
		go f.acceptTCP(ctx, lis, port)
	case protoUDP:
		if _, ok := f.udp[k]; ok {
			return nil
		}
		pc, err := net.ListenUDP(protoUDP, &net.UDPAddr{IP: f.bindIP, Port: int(port)})
		if err != nil {
			return fmt.Errorf("listen %s: %w", k, err)
		}
		target := net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port)))
		// Each flow's idle timeout is forwarder.UDPConnTrackTimeout (90s).
		// The dial closure runs for every new client flow, including
		// flows that arrive long after Add returns. ctx must therefore
		// be a forwarder-lifetime context (in production, the
		// scanner's lifetime context); a request-scoped or per-tick
		// ctx would silently break new-flow dialing once cancelled.
		proxy, err := forwarder.NewUDPProxy(pc, func() (net.Conn, error) {
			return f.dialer.DialContext(ctx, protoUDP, target)
		})
		if err != nil {
			_ = pc.Close()
			return fmt.Errorf("udp proxy %s: %w", k, err)
		}
		f.udp[k] = proxy
		go proxy.Run()
	default:
		return fmt.Errorf("loopback forwarder: unsupported protocol %q", proto)
	}
	return nil
}

func (f *loopbackForwarder) Remove(proto string, port uint16) error {
	k := key(proto, port)
	f.mu.Lock()
	defer f.mu.Unlock()
	switch proto {
	case protoTCP:
		if lis, ok := f.tcp[k]; ok {
			delete(f.tcp, k)
			return lis.Close()
		}
	case protoUDP:
		if proxy, ok := f.udp[k]; ok {
			delete(f.udp, k)
			return proxy.Close()
		}
	}
	return nil
}

// Close shuts every registered TCP listener and UDP proxy. In-flight
// pipeTCP goroutines for accepted connections continue until the
// peer disconnects or their half-close drain deadline (30s) fires;
// Close does not wait for them. This is intentional for
// process-exit shutdown — the goroutines die with the process.
func (f *loopbackForwarder) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	var errs []error
	for k, l := range f.tcp {
		if err := l.Close(); err != nil {
			errs = append(errs, err)
		}
		delete(f.tcp, k)
	}
	for k, proxy := range f.udp {
		if err := proxy.Close(); err != nil {
			errs = append(errs, err)
		}
		delete(f.udp, k)
	}
	return errors.Join(errs...)
}

const (
	acceptRetryInitialBackoff = 100 * time.Millisecond
	acceptRetryMaxBackoff     = 5 * time.Second
	halfCloseDrainTimeout     = 30 * time.Second
)

func (f *loopbackForwarder) acceptTCP(ctx context.Context, lis net.Listener, port uint16) {
	backoff := acceptRetryInitialBackoff
	// loggedAcceptError throttles per-listener Accept-error logs the
	// same way logAddFailure throttles publish-failure logs in the
	// scanner. Sustained FD pressure (EMFILE) saturates the loop at
	// the 5 s cap; without the throttle, the loop emits one Error
	// every 5 s indefinitely.
	loggedAcceptError := false
	for {
		conn, err := lis.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			// Retry with exponential backoff on transient errors (EMFILE
			// under FD pressure, ENOBUFS). The listener stays registered
			// in f.tcp; once the pressure clears, Accept succeeds.
			if !loggedAcceptError {
				log.Errorf("loopback forwarder accept tcp/%d: %s (retry in %s)", port, err, backoff)
				loggedAcceptError = true
			} else {
				log.Debugf("loopback forwarder accept tcp/%d: %s (retry in %s)", port, err, backoff)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > acceptRetryMaxBackoff {
				backoff = acceptRetryMaxBackoff
			}
			continue
		}
		backoff = acceptRetryInitialBackoff
		loggedAcceptError = false
		go f.pipeTCP(ctx, conn, port)
	}
}

func (f *loopbackForwarder) pipeTCP(ctx context.Context, in net.Conn, port uint16) {
	defer in.Close()
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port)))
	out, err := f.dialer.DialContext(ctx, protoTCP, addr)
	if err != nil {
		log.Debugf("loopback forwarder dial tcp/%d: %s", port, err)
		return
	}
	defer out.Close()
	// Half-close per direction so a client that signals end-of-request
	// via CloseWrite still receives the upstream's response. After the
	// first copy finishes, a drain deadline on both reads caps the wait
	// for the other direction, so a wedged peer cannot leak this
	// goroutine.
	done := make(chan struct{}, 2)
	copyDir := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if tcp, ok := dst.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
		done <- struct{}{}
	}
	go copyDir(out, in)
	go copyDir(in, out)
	<-done
	drainDeadline := time.Now().Add(halfCloseDrainTimeout)
	// Bound both reads (peer goes silent) and writes (peer's recv
	// buffer fills) on whichever direction is still copying. A
	// read-only deadline leaves a write stuck in io.Copy unbounded
	// when the remaining peer applies TCP backpressure.
	_ = in.SetReadDeadline(drainDeadline)
	_ = out.SetReadDeadline(drainDeadline)
	_ = in.SetWriteDeadline(drainDeadline)
	_ = out.SetWriteDeadline(drainDeadline)
	<-done
}
