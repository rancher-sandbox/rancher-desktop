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
// Mirrors Lima's pkg/portfwd/listener.go.

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
)

type loopbackForwarder struct {
	bindIP net.IP
	dialer net.Dialer

	mu  sync.Mutex
	tcp map[string]net.Listener
	udp map[string]net.PacketConn
}

func newLoopbackForwarder(bindIP net.IP) *loopbackForwarder {
	return &loopbackForwarder{
		bindIP: bindIP,
		tcp:    make(map[string]net.Listener),
		udp:    make(map[string]net.PacketConn),
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
		f.udp[k] = pc
		go f.relayUDP(ctx, pc, port)
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
		if pc, ok := f.udp[k]; ok {
			delete(f.udp, k)
			return pc.Close()
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
	for k, p := range f.udp {
		if err := p.Close(); err != nil {
			errs = append(errs, err)
		}
		delete(f.udp, k)
	}
	return errors.Join(errs...)
}

func (f *loopbackForwarder) acceptTCP(ctx context.Context, lis net.Listener, port uint16) {
	for {
		conn, err := lis.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Errorf("loopback forwarder accept tcp/%d: %s", port, err)
			return
		}
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
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(out, in); done <- struct{}{} }()
	go func() { _, _ = io.Copy(in, out); done <- struct{}{} }()
	<-done
}

// relayUDP forwards UDP datagrams between the bindIP listener and
// 127.0.0.1, multiplexing concurrent flows by source address. Each
// flow holds a dedicated outbound socket; the socket closes after
// udpIdleTimeout of no upstream reply.
func (f *loopbackForwarder) relayUDP(ctx context.Context, pc net.PacketConn, port uint16) {
	target := net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port)))

	var (
		mu    sync.Mutex
		flows = make(map[string]net.Conn)
	)
	defer func() {
		mu.Lock()
		for k, out := range flows {
			_ = out.Close()
			delete(flows, k)
		}
		mu.Unlock()
	}()

	buf := make([]byte, 64*1024)
	for {
		n, src, err := pc.ReadFrom(buf)
		if err != nil {
			return
		}
		srcKey := src.String()

		mu.Lock()
		out, ok := flows[srcKey]
		if !ok {
			conn, derr := f.dialer.DialContext(ctx, "udp", target)
			if derr != nil {
				mu.Unlock()
				log.Debugf("loopback forwarder dial udp/%d: %s", port, derr)
				continue
			}
			out = conn
			flows[srcKey] = out
			go f.readUDPReplies(pc, out, src, srcKey, &mu, flows)
		}
		mu.Unlock()

		_, _ = out.Write(buf[:n])
	}
}

const udpIdleTimeout = 30 * time.Second

// readUDPReplies pumps datagrams from a per-flow outbound socket back
// to the original client. A SetReadDeadline of udpIdleTimeout per Read
// closes the flow once the upstream stops replying.
func (f *loopbackForwarder) readUDPReplies(pc net.PacketConn, out net.Conn, srcAddr net.Addr, srcKey string, mu *sync.Mutex, flows map[string]net.Conn) {
	rbuf := make([]byte, 64*1024)
	for {
		_ = out.SetReadDeadline(time.Now().Add(udpIdleTimeout))
		n, err := out.Read(rbuf)
		if err != nil {
			mu.Lock()
			if flows[srcKey] == out {
				delete(flows, srcKey)
			}
			mu.Unlock()
			_ = out.Close()
			return
		}
		_, _ = pc.WriteTo(rbuf[:n], srcAddr)
	}
}
