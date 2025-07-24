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
	"context"
	"flag"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/log"
	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/portproxy"
)

var (
	debug        bool
	logFile      string
	socketFile   string
	upstreamAddr string
	udpBuffer    int
)

const (
	defaultLogPath = "/var/log/wsl-proxy.log"
	defaultSocket  = "/run/wsl-proxy.sock"
	bridgeIPAddr   = "192.168.143.1"
	// Set UDP buffer size to 8 MB
	defaultUDPBufferSize = 8 * 1024 * 1024 // 8 MB in bytes
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging.")
	flag.StringVar(&logFile, "logfile", defaultLogPath, "path to the logfile for wsl-proxy process")
	flag.StringVar(&socketFile, "socketFile", defaultSocket, "path to the .sock file for UNIX socket")
	flag.StringVar(&upstreamAddr, "upstreamAddress", bridgeIPAddr, "IP address of the upstream server to forward to")
	flag.IntVar(&udpBuffer, "udpBuffer", defaultUDPBufferSize, "max buffer size in bytes for UDP socket I/O")
	flag.Parse()

	setupLogging(logFile)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	socket, err := net.Listen("unix", socketFile)
	if err != nil {
		logrus.Fatalf("failed to create listener for published ports: %s", err)
		return
	}
	proxyConfig := &portproxy.ProxyConfig{
		UpstreamAddress: upstreamAddr,
		UDPBufferSize:   udpBuffer,
	}
	proxy := portproxy.NewPortProxy(ctx, socket, proxyConfig)

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		logrus.Println("Shutting down...")
		if err := proxy.Close(); err != nil {
			logrus.Errorf("proxy close error: %s", err)
		}
		os.Exit(0)
	}()

	err = proxy.Start()
	if err != nil {
		logrus.Errorf("failed to start accepting: %s", err)
		return
	}
}

func setupLogging(logFile string) {
	if err := log.SetOutputFile(logFile, logrus.StandardLogger()); err != nil {
		logrus.Fatalf("setting logger's output file failed: %v", err)
	}

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	} else {
		logrus.SetLevel(logrus.InfoLevel)
	}
}
