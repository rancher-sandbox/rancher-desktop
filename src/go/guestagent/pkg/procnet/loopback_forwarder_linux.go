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
func (f *loopbackForwarder) Add(ctx context.Context, proto string, port uint16) error {
	k := key(proto, port)
	f.mu.Lock()
	defer f.mu.Unlock()

	switch proto {
	case "tcp":
		if _, ok := f.tcp[k]; ok {
			return nil
		}
		lis, err := net.ListenTCP("tcp", &net.TCPAddr{IP: f.bindIP, Port: int(port)})
		if err != nil {
			return fmt.Errorf("listen %s: %w", k, err)
		}
		f.tcp[k] = lis
		go f.acceptTCP(ctx, lis, port)
	case "udp":
		if _, ok := f.udp[k]; ok {
			return nil
		}
		pc, err := net.ListenUDP("udp", &net.UDPAddr{IP: f.bindIP, Port: int(port)})
		if err != nil {
			return fmt.Errorf("listen %s: %w", k, err)
		}
		target := net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port)))
		// Each flow's idle timeout is forwarder.UDPConnTrackTimeout (90s).
		proxy, err := forwarder.NewUDPProxy(pc, func() (net.Conn, error) {
			return f.dialer.DialContext(ctx, "udp", target)
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
	case "tcp":
		if lis, ok := f.tcp[k]; ok {
			delete(f.tcp, k)
			return lis.Close()
		}
	case "udp":
		if proxy, ok := f.udp[k]; ok {
			delete(f.udp, k)
			return proxy.Close()
		}
	}
	return nil
}

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
	for {
		conn, err := lis.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			// Retry with exponential backoff on transient errors (EMFILE
			// under FD pressure, ENOBUFS). The listener stays registered
			// in f.tcp; once the pressure clears, Accept succeeds.
			log.Errorf("loopback forwarder accept tcp/%d: %s (retry in %s)", port, err, backoff)
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
		go f.pipeTCP(ctx, conn, port)
	}
}

func (f *loopbackForwarder) pipeTCP(ctx context.Context, in net.Conn, port uint16) {
	defer in.Close()
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port)))
	out, err := f.dialer.DialContext(ctx, "tcp", addr)
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
	_ = in.SetReadDeadline(drainDeadline)
	_ = out.SetReadDeadline(drainDeadline)
	<-done
}
