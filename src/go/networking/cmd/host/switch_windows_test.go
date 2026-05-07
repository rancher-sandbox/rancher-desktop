/*
Copyright © 2026 SUSE LLC
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
*/

package main

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// localTCPListener gives us a real net.Listener we can use for tests without
// needing the Hyper-V vsock layer.
func localTCPListener(t *testing.T) net.Listener {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	require.NoError(t, err)
	return ln
}

func TestFirstConnListener_ReplaysFirstConnection(t *testing.T) {
	ln := localTCPListener(t)
	defer ln.Close()

	// Open a real connection to the underlying listener.
	dialed, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", ln.Addr().String())
	require.NoError(t, err)
	accepted, err := ln.Accept()
	require.NoError(t, err)
	defer dialed.Close()
	defer accepted.Close()

	wrapped := &firstConnListener{Listener: ln, first: accepted}

	// First Accept must return the pre-accepted connection.
	got, err := wrapped.Accept()
	require.NoError(t, err)
	assert.Same(t, accepted, got, "first Accept should replay the pre-accepted connection")

	// Subsequent Accept should delegate to the real listener.
	go func() {
		c, _ := (&net.Dialer{}).DialContext(t.Context(), "tcp", ln.Addr().String())
		_ = c.Close()
	}()
	conn2, err := wrapped.Accept()
	if assert.NoError(t, err) {
		_ = conn2.Close()
	}
}

func TestFirstConnListener_ConcurrentAcceptOnlyReplaysOnce(t *testing.T) {
	ln := localTCPListener(t)
	defer ln.Close()

	// Pre-accept one connection to use as the "first".
	dialed, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", ln.Addr().String())
	require.NoError(t, err)
	accepted, err := ln.Accept()
	require.NoError(t, err)
	defer dialed.Close()
	defer accepted.Close()

	wrapped := &firstConnListener{Listener: ln, first: accepted}

	// Spawn concurrent Accept calls; only one should get the replay,
	// the others should fall through to ln.Accept (which we'll feed
	// fresh dials so they don't block forever).
	const concurrent = 4
	conns := make(chan net.Conn, concurrent)
	errs := make(chan error, concurrent)
	for i := 0; i < concurrent; i++ {
		go func() {
			c, e := wrapped.Accept()
			conns <- c
			errs <- e
		}()
	}
	// Feed (concurrent - 1) real dials so the non-replay goroutines unblock.
	for i := 0; i < concurrent-1; i++ {
		go func() {
			c, _ := (&net.Dialer{}).DialContext(t.Context(), "tcp", ln.Addr().String())
			if c != nil {
				_ = c.Close()
			}
		}()
	}

	replayCount := 0
	deadline := time.After(5 * time.Second)
	for i := 0; i < concurrent; i++ {
		select {
		case c := <-conns:
			<-errs
			if c == accepted {
				replayCount++
			} else if c != nil {
				_ = c.Close()
			}
		case <-deadline:
			t.Fatalf("timed out waiting for Accept goroutine %d of %d", i+1, concurrent)
		}
	}
	assert.Equal(t, 1, replayCount, "replay should happen exactly once across concurrent Accept calls")
}

func TestAcceptWithTimeout_TimesOutWhenNoConnection(t *testing.T) {
	ln := localTCPListener(t)
	// ln will be closed by acceptWithTimeout on timeout.

	conn, err := acceptWithTimeout(context.Background(), ln, 50*time.Millisecond)
	assert.Nil(t, conn)
	assert.ErrorIs(t, err, errAcceptTimeout)
}

func TestAcceptWithTimeout_ReturnsConnectionWhenAvailable(t *testing.T) {
	ln := localTCPListener(t)
	defer ln.Close()

	go func() {
		// Dial after a small delay to ensure Accept is waiting.
		time.Sleep(10 * time.Millisecond)
		c, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", ln.Addr().String())
		if err == nil {
			_ = c.Close()
		}
	}()

	conn, err := acceptWithTimeout(context.Background(), ln, time.Second)
	require.NoError(t, err)
	require.NotNil(t, conn)
	_ = conn.Close()
}

func TestAcceptWithTimeout_HonorsContextCancellation(t *testing.T) {
	ln := localTCPListener(t)
	// ln will be closed by acceptWithTimeout on cancel.

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	conn, err := acceptWithTimeout(ctx, ln, time.Hour)
	assert.Nil(t, conn)
	assert.True(t, errors.Is(err, context.Canceled), "expected context.Canceled, got %v", err)
}
