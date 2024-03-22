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
package main

import (
	"errors"
	"flag"
	"io"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/utils"
	"github.com/sirupsen/logrus"
)

var (
	debug        bool
	upstreamAddr string
	listenAddr   string
)

const (
	k8sAPI            = "192.168.1.2:6443"
	defaultListenAddr = "127.0.0.1:6443"
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging.")
	flag.StringVar(&upstreamAddr, "upstream-addr", k8sAPI, "The upstream server's address (k3s API sever).")
	flag.StringVar(&listenAddr, "listen-addr", defaultListenAddr, "The server's address in an IP:PORT format.")
	flag.Parse()

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		logrus.Fatalf("Failed to listen on %s: %s", listenAddr, err)
	}

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// WaitGroup to wait for all connections to finish before shutting down
	var wg sync.WaitGroup

	go func() {
		<-sigCh
		logrus.Println("Shutting down...")
		listener.Close()
		wg.Wait()
		os.Exit(0)
	}()

	logrus.Infof("Proxy server started listening on %s, forwarding to %s", listenAddr, upstreamAddr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			// Check if the error is due to listener being closed
			if errors.Is(err, net.ErrClosed) {
				break
			}
			logrus.Errorf("Failed to accept listener: %s", err)
			continue
		}
		logrus.Debugf("Accepted connection from %s", conn.RemoteAddr())

		wg.Add(1)

		go func(conn net.Conn) {
			defer wg.Done()
			defer conn.Close()
			utils.Pipe(conn, upstreamAddr)
		}(conn)
	}
}

func pipe(conn net.Conn, upstreamAddr string) {
	upstream, err := net.Dial("tcp", upstreamAddr)
	if err != nil {
		logrus.Errorf("Failed to dial upstream %s: %s", upstreamAddr, err)
		return
	}
	defer upstream.Close()

	go func() {
		if _, err := io.Copy(upstream, conn); err != nil {
			logrus.Debugf("Error copying to upstream: %s", err)
		}
	}()

	if _, err := io.Copy(conn, upstream); err != nil {
		logrus.Debugf("Error copying from upstream: %s", err)
	}
}
