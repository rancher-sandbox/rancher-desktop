/*
Copyright © 2026 SUSE LLC
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
*/

package procnet

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// startUpstream binds a TCP listener on 127.0.0.1:0 that writes `reply`
// to every accepted connection and closes it. Returns the chosen port
// and a stop function.
func startUpstream(t *testing.T, reply string) (uint16, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen upstream: %v", err)
	}
	port := uint16(ln.Addr().(*net.TCPAddr).Port)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_, _ = io.WriteString(c, reply)
			_ = c.Close()
		}
	}()
	return port, func() {
		_ = ln.Close()
		<-done
	}
}

func TestForwarderTCPEndToEnd(t *testing.T) {
	port, stop := startUpstream(t, "hello from upstream")
	defer stop()

	bindIP := net.ParseIP("127.0.0.99")
	fwd := newLoopbackForwarder(bindIP)
	defer fwd.Close()
	if err := fwd.Add(context.Background(), "tcp", port); err != nil {
		t.Fatalf("forwarder.Add: %v", err)
	}

	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.99:%d", port), 2*time.Second)
	if err != nil {
		t.Skipf("dial via 127.0.0.99 failed (loopback aliases unavailable): %v", err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	buf, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read from forwarder: %v", err)
	}
	if got, want := string(buf), "hello from upstream"; got != want {
		t.Fatalf("forwarded payload = %q, want %q", got, want)
	}
}

func TestForwarderRemoveStopsListening(t *testing.T) {
	port, stop := startUpstream(t, "x")
	defer stop()

	bindIP := net.ParseIP("127.0.0.99")
	fwd := newLoopbackForwarder(bindIP)
	defer fwd.Close()

	if err := fwd.Add(context.Background(), "tcp", port); err != nil {
		t.Fatalf("forwarder.Add: %v", err)
	}
	// Sanity: forwarder is listening.
	probe, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.99:%d", port), 2*time.Second)
	if err != nil {
		t.Skipf("dial via 127.0.0.99 failed: %v", err)
	}
	probe.Close()

	if err := fwd.Remove("tcp", port); err != nil {
		t.Fatalf("forwarder.Remove: %v", err)
	}

	// After Remove the listener is closed; dial should refuse.
	_, err = net.DialTimeout("tcp", fmt.Sprintf("127.0.0.99:%d", port), 500*time.Millisecond)
	if err == nil {
		t.Fatal("dial succeeded after Remove; expected connection refused")
	}
	if !strings.Contains(err.Error(), "refused") && !strings.Contains(err.Error(), "timeout") {
		t.Logf("dial-after-Remove err (acceptable): %v", err)
	}
}

func TestForwarderAddIsIdempotent(t *testing.T) {
	port, stop := startUpstream(t, "ok")
	defer stop()

	bindIP := net.ParseIP("127.0.0.99")
	fwd := newLoopbackForwarder(bindIP)
	defer fwd.Close()

	for i := 0; i < 3; i++ {
		if err := fwd.Add(context.Background(), "tcp", port); err != nil {
			t.Fatalf("forwarder.Add iteration %d: %v", i, err)
		}
	}
}
