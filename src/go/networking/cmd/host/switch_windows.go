/*
Copyright © 2023 SUSE LLC
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

package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/containers/gvisor-tap-vsock/pkg/virtualnetwork"
	"github.com/dustin/go-humanize"
	"github.com/linuxkit/virtsock/pkg/hvsock"
	"github.com/sirupsen/logrus"
	"golang.org/x/sync/errgroup"

	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/vsock"
)

var (
	debug             bool
	virtualSubnet     string
	staticPortForward arrayFlags
)

const (
	vsockListenPort    = 6656
	vsockHandshakePort = 6669
	timeoutSeconds     = 5 * 60
	debugLogInterval   = 5 * time.Second
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging")
	flag.StringVar(&virtualSubnet, "subnet", config.DefaultSubnet,
		fmt.Sprintf("Subnet range with CIDR suffix for virtual network, e,g: %s", config.DefaultSubnet))
	flag.Var(&staticPortForward, "port-forward",
		"List of ports that needs to be pre forwarded to the WSL VM in Host:Port=Guest:Port format e.g: 127.0.0.1:2222=192.168.127.2:22")
	flag.Parse()

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	// config flags
	ctx, cancel := context.WithCancel(context.Background())
	groupErrs, ctx := errgroup.WithContext(ctx)

	// catch user issued signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	subnet, err := config.ValidateSubnet(virtualSubnet)
	if err != nil {
		logrus.Fatal(err)
	}

	logrus.Debugf("attempting to start with the following subnet: %+v", subnet)

	portForwarding, err := config.ParsePortForwarding(staticPortForward)
	if err != nil {
		logrus.Fatal(err)
	}

	cfg := newConfig(*subnet, portForwarding, debug)

	logrus.Debugf("attempting to start a virtual network with the following config: %+v", cfg)
	vn, err := virtualnetwork.New(&cfg)
	if err != nil {
		logrus.Fatalf("creating virtual network failed: %v", err)
	}

	apiServer := fmt.Sprintf("%s:80", cfg.GatewayIP)
	vnLn, err := vn.Listen("tcp", apiServer)
	if err != nil {
		logrus.Fatalf("listening on port forwarding API failed: %v", err)
	}
	mux := http.NewServeMux()
	mux.Handle("/services/forwarder/all", vn.Mux())
	mux.Handle("/services/forwarder/expose", vn.Mux())
	mux.Handle("/services/forwarder/unexpose", vn.Mux())
	httpServe(ctx, groupErrs, vnLn, mux)
	logrus.Infof("port forwarding API server is running on: %s", apiServer)

	if debug {
		groupErrs.Go(func() error {
			return debugLogLoop(ctx, vn, debugLogInterval)
		})
	}

	groupErrs.Go(func() error {
		return runHandshakeLoop(ctx, vn)
	})

	// Wait for something to happen
	groupErrs.Go(func() error {
		select {
		// Catch signals so exits are graceful and defers can run
		case s := <-sigChan:
			cancel()
			return fmt.Errorf("signal caught: %v", s)
		case <-ctx.Done():
			return nil
		}
	})
	// Wait for all of the go funcs to finish up
	if err := groupErrs.Wait(); err != nil {
		logrus.Error(err)
		os.Exit(1)
	}
}

// runHandshakeLoop owns the handshake-and-accept lifecycle.  The peer (the
// Linux network-setup process inside the WSL distro) can disappear and come
// back -- most notably when Rancher Desktop switches container engines, which
// terminates and re-creates the WSL distro.  When that happens, residual
// Hyper-V vsock state can let an initial handshake "succeed" even though no
// real Linux peer is up yet (see handshakeWithRetry); the phantom data
// connection then dies after about 30 seconds.  When that data connection
// (or any successor) goes away, we redo the entire handshake so a fresh
// network-setup peer can attach.
//
// A more direct fix would be to add a nonce exchange to the data-connection
// protocol so a phantom peer cannot mimic one, but that requires a
// coordinated change in the WSL distro tarball (network-setup) and bumping
// the WSLDistro version.  This loop is a host-only workaround that keeps the
// fix self-contained.
func runHandshakeLoop(ctx context.Context, vn *virtualnetwork.VirtualNetwork) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		ln, err := handshakeWithRetry(ctx, vsockHandshakePort, vsock.SignaturePhrase)
		if err != nil {
			return err
		}
		logrus.Info("waiting for clients...")
		serveAccepts(ctx, vn, ln)
		_ = ln.Close()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		logrus.Warn("data connection lost; restarting handshake")
	}
}

// serveAccepts handles a single connection from ln through vn, returning when
// the connection ends — because the context is cancelled or because the peer
// has gone away.  Either way, the caller should redo the handshake.
func serveAccepts(ctx context.Context, vn *virtualnetwork.VirtualNetwork, ln net.Listener) {
	conn, err := ln.Accept()
	if err != nil {
		logrus.Errorf("failed to accept: %v", err)
		return
	}
	// AcceptStdio blocks for the lifetime of the connection, returning when
	// the peer goes away.  Returning here lets runHandshakeLoop redo the
	// handshake.
	err = vn.AcceptStdio(ctx, conn)
	if err != nil {
		logrus.Errorf("data connection error: %v", err)
	} else {
		logrus.Info("data connection closed by peer")
	}
}

func debugLogLoop(ctx context.Context, vn *virtualnetwork.VirtualNetwork, interval time.Duration) error {
	for {
		select {
		case <-time.After(interval):
			logrus.Debugf("%v sent to the VM, %v received from the VM", humanize.Bytes(vn.BytesSent()), humanize.Bytes(vn.BytesReceived()))
		case <-ctx.Done():
			return nil
		}
	}
}

func httpServe(ctx context.Context, g *errgroup.Group, ln net.Listener, mux http.Handler) {
	g.Go(func() error {
		<-ctx.Done()
		return ln.Close()
	})
	g.Go(func() error {
		s := &http.Server{
			Handler:      mux,
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 10 * time.Second,
		}
		err := s.Serve(ln)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})
}

func vsockHandshake(ctx context.Context, handshakePort uint32, signature string) (net.Listener, error) {
	bailout := time.After(time.Second * timeoutSeconds)
	vmGUID, err := vsock.GetVMGUID(ctx, signature, handshakePort, bailout)
	if err != nil {
		return nil, fmt.Errorf("trying to find WSL GUID failed: %w", err)
	}
	logrus.Infof("successful handshake, waiting for a vsock connection from VMGUID: %v on Port: %v", vmGUID.String(), vsockListenPort)
	ln, err := vsock.Listen(vmGUID, vsockListenPort)
	if err != nil {
		return nil, fmt.Errorf("creating vsock listener for host-switch failed: %w", err)
	}
	err = signalVsockListenerReady(vmGUID, vsockHandshakePort)
	if err != nil {
		return nil, fmt.Errorf("sending %s signal to peer process failed: %w", vsock.ReadySignal, err)
	}
	return ln, nil
}

// handshakeValidationTimeout is how long to wait for a real data connection
// from the peer after vsockHandshake reports success.  If no connection
// arrives, the handshake is treated as a phantom and retried.
const handshakeValidationTimeout = 10 * time.Second

// handshakeMaxAttempts caps the retries when the peer never produces a data
// connection.  This guards against an infinite loop if the peer is
// unreachable; the underlying vsockHandshake already has its own
// timeoutSeconds budget per attempt for finding the VMGUID.
const handshakeMaxAttempts = 5

// firstConnListener wraps a net.Listener and replays one already-accepted
// connection on its first Accept call.  Subsequent Accept calls delegate to
// the underlying listener.  This lets handshakeWithRetry validate the peer by
// accepting the data connection inside the handshake routine, without forcing
// the rest of host-switch to know about validation.
type firstConnListener struct {
	net.Listener
	first  net.Conn
	served atomic.Bool
}

func (l *firstConnListener) Accept() (net.Conn, error) {
	if l.served.CompareAndSwap(false, true) {
		return l.first, nil
	}
	return l.Listener.Accept()
}

// handshakeWithRetry performs vsockHandshake and then validates that a real
// peer is on the other end by waiting for the data connection it is about to
// initiate.  If the validation times out (a phantom handshake — observed when
// engine-switching tears down and re-creates the WSL distro, and stale
// Hyper-V vsock state responds before the new peer comes up), we close the
// listener and retry from scratch.  The first real connection is preserved
// and replayed via firstConnListener, so the caller's accept loop sees it as
// the first client connection.
func handshakeWithRetry(ctx context.Context, handshakePort uint32, signature string) (net.Listener, error) {
	var lastErr error
	for attempt := 1; attempt <= handshakeMaxAttempts; attempt++ {
		ln, err := vsockHandshake(ctx, handshakePort, signature)
		if err != nil {
			return nil, err
		}
		conn, err := acceptWithTimeout(ctx, ln, handshakeValidationTimeout)
		if err == nil {
			logrus.Infof("validated handshake on attempt %d", attempt)
			return &firstConnListener{Listener: ln, first: conn}, nil
		}
		_ = ln.Close()
		if ctx.Err() != nil {
			return nil, err
		}
		lastErr = err
		logrus.Warnf("handshake attempt %d unvalidated (%v); retrying", attempt, err)
	}
	return nil, fmt.Errorf("handshake never produced a data connection after %d attempts: %w", handshakeMaxAttempts, lastErr)
}

// acceptWithTimeout calls ln.Accept in a goroutine and returns the result, or
// errAcceptTimeout if no connection arrives in time.  On timeout (or context
// cancellation) it closes ln, which unblocks the goroutine so it does not
// leak.
func acceptWithTimeout(ctx context.Context, ln net.Listener, timeout time.Duration) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		conn, err := ln.Accept()
		ch <- result{conn, err}
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	// On timeout or cancellation, close ln to unblock the goroutine, then drain
	// ch.  If Accept won the race, close the returned connection; otherwise
	// the peer's data connection leaks and the retry hits the same deadlock.
	select {
	case r := <-ch:
		return r.conn, r.err
	case <-timer.C:
		_ = ln.Close()
		if r := <-ch; r.conn != nil {
			_ = r.conn.Close()
		}
		return nil, errAcceptTimeout
	case <-ctx.Done():
		_ = ln.Close()
		if r := <-ch; r.conn != nil {
			_ = r.conn.Close()
		}
		return nil, ctx.Err()
	}
}

var errAcceptTimeout = errors.New("timed out waiting for peer data connection")

func signalVsockListenerReady(vmGUID hvsock.GUID, peerPort uint32) error {
	conn, err := vsock.GetVsockConnection(vmGUID, peerPort)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Write([]byte(vsock.ReadySignal))
	if err != nil {
		return err
	}

	return nil
}
