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
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/log"
	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/portproxy"
)

var (
	debug        bool
	upstreamAddr string
	listenAddr   string
	logFile      string
)

const (
	k8sAPI            = "192.168.1.2:6443"
	defaultListenAddr = "127.0.0.1:6443"
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging.")
	flag.StringVar(&upstreamAddr, "upstream-addr", k8sAPI, "The upstream server's address (k3s API sever).")
	flag.StringVar(&listenAddr, "listen-addr", defaultListenAddr, "The server's address in an IP:PORT format.")
	flag.StringVar(&logFile, "logfile", "/var/log/wsl-proxy.log", "path to the logfile for wsl-proxy process")
	flag.Parse()

	setupLogging(logFile)

	proxy, err := portproxy.NewPortProxy("/run/wsl-proxy.sock")
	if err != nil {
		logrus.Errorf("failed to create listener for published ports: %s", err)
		return
	}

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		logrus.Println("Shutting down...")
		proxy.Close()
		proxy.Wait()
		os.Exit(0)
	}()

	err = proxy.Listen()
	if err != nil {
		logrus.Errorf("failed to start listening: %s", err)
		return
	}
}

func setupLogging(logFile string) {
	if err := log.SetOutputFile(logFile, logrus.StandardLogger()); err != nil {
		logrus.Fatalf("setting logger's output file failed: %v", err)
	}

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}
}
