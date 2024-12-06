/*
Copyright © 2022 SUSE LLC
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

// Rancher-desktop-guestagent runs inside the WSL VM on Windows. It is
// primarily used to monitor and forward Kubernetes Service Ports
// (NodePorts and LoadBalancers) to the host. Also, it can be configured
// to perform port forwarding for the exposed container ports on both
// Moby and Containerd backends.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/containerd"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/docker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/iptables"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/kube"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/procnet"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
	"golang.org/x/sync/errgroup"
)

//nolint:gochecknoglobals
var (
	debug            = flag.Bool("debug", false, "display debug output")
	configPath       = flag.String("kubeconfig", "/etc/rancher/k3s/k3s.yaml", "path to kubeconfig")
	enableKubernetes = flag.Bool("kubernetes", false, "enable Kubernetes service forwarding")
	enableDocker     = flag.Bool("docker", false, "enable Docker event monitoring")
	enableContainerd = flag.Bool("containerd", false, "enable Containerd event monitoring")
	containerdSock   = flag.String("containerdSock",
		containerdSocketFile,
		"file path for Containerd socket address")
	k8sServiceListenerAddr = flag.String("k8sServiceListenerAddr", net.IPv4zero.String(),
		"address to bind Kubernetes services to on the host, valid options are 0.0.0.0 or 127.0.0.1")
	adminInstall = flag.Bool("adminInstall", false, "indicates if Rancher Desktop is installed as admin or not")
	k8sAPIPort   = flag.String("k8sAPIPort", "6443",
		"K8sAPI port number to forward to rancher-desktop wsl-proxy as a static portMapping event")
	tapIfaceIP = flag.String("tap-interface-ip", "192.168.127.2",
		"IP address for the tap interface eth0 in network namespace")
)

const (
	iptablesUpdateInterval = 3 * time.Second
	procNetScanInterval    = 3 * time.Second
	socketInterval         = 5 * time.Second
	socketRetryTimeout     = 2 * time.Minute
	dockerSocketFile       = "/var/run/docker.sock"
	containerdSocketFile   = "/run/k3s/containerd/containerd.sock"
)

func main() {
	// Setup logging with debug and trace levels
	logger := log.NewStandard()

	flag.Parse()

	if *debug {
		logger.Level = log.DebugLevel
	}

	log.Current = logger

	log.Infof("Starting Rancher Desktop Agent in [AdminInstall=%t] mode", *adminInstall)

	if os.Geteuid() != 0 {
		log.Fatal("agent must run as root")
	}

	groupCtx, cancel := context.WithCancel(context.Background())
	group, ctx := errgroup.WithContext(groupCtx)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM)

	go func() {
		s := <-sigCh
		log.Debugf("received [%s] signal", s)
		cancel()
	}()

	if !*enableContainerd &&
		!*enableDocker {
		log.Fatal("requires either -docker or -containerd enabled.")
	}

	if *enableContainerd &&
		*enableDocker {
		log.Fatal("requires either -docker or -containerd but not both.")
	}

	var portTracker tracker.Tracker

	forwarder := forwarder.NewWSLProxyForwarder("/run/wsl-proxy.sock")
	portTracker = tracker.NewAPITracker(ctx, forwarder, tracker.GatewayBaseURL, *tapIfaceIP, *adminInstall)
	// Manually register the port for K8s API, we would
	// only want to send this manual port mapping if both
	// of the following conditions are met:
	// 1) if kubernetes is enabled
	// 2) when wsl-proxy for wsl-integration is enabled
	if *enableKubernetes {
		port, err := nat.NewPort("tcp", *k8sAPIPort)
		if err != nil {
			log.Fatalf("failed to parse port for k8s API: %v", err)
		}
		k8sAPIPortMapping := types.PortMapping{
			Remove: false,
			Ports: nat.PortMap{
				port: []nat.PortBinding{
					{
						HostIP:   "127.0.0.1",
						HostPort: *k8sAPIPort,
					},
				},
			},
		}
		if err := forwarder.Send(k8sAPIPortMapping); err != nil {
			log.Fatalf("failed to send a static portMapping event to wsl-proxy: %v", err)
		}
		log.Debugf("successfully forwarded k8s API port [%s] to wsl-proxy", *k8sAPIPort)
	}

	if *enableContainerd {
		group.Go(func() error {
			eventMonitor, err := containerd.NewEventMonitor(*containerdSock, portTracker)
			if err != nil {
				return fmt.Errorf("error initializing containerd event monitor: %w", err)
			}
			if err := tryConnectAPI(ctx, containerdSocketFile, eventMonitor.IsServing); err != nil {
				return err
			}
			eventMonitor.MonitorPorts(ctx)

			return eventMonitor.Close()
		})
	}

	if *enableDocker {
		group.Go(func() error {
			eventMonitor, err := docker.NewEventMonitor(portTracker)
			if err != nil {
				return fmt.Errorf("error initializing docker event monitor: %w", err)
			}
			if err := tryConnectAPI(ctx, dockerSocketFile, eventMonitor.Info); err != nil {
				return err
			}
			eventMonitor.MonitorPorts(ctx)
			eventMonitor.Flush()

			return nil
		})
	}

	if *enableKubernetes {
		k8sServiceListenerIP := net.ParseIP(*k8sServiceListenerAddr)

		if k8sServiceListenerIP == nil || !(k8sServiceListenerIP.Equal(net.IPv4zero) ||
			k8sServiceListenerIP.Equal(net.IPv4(127, 0, 0, 1))) {
			log.Fatalf("empty or none valid input for Kubernetes service listener IP address %s. "+
				"Valid options are 0.0.0.0 and 127.0.0.1.", *k8sServiceListenerAddr)
		}

		group.Go(func() error {
			// Watch for kube
			err := kube.WatchForServices(ctx,
				*configPath,
				k8sServiceListenerIP,
				portTracker)
			if err != nil {
				return fmt.Errorf("kubernetes service watcher failed: %w", err)
			}
			return nil
		})

		group.Go(func() error {
			iptablesScanner := iptables.NewIptablesScanner()
			iptablesHandler := iptables.New(ctx, portTracker, iptablesScanner, k8sServiceListenerIP, iptablesUpdateInterval)
			err := iptablesHandler.ForwardPorts()
			if err != nil {
				return fmt.Errorf("iptables port forwarding failed: %w", err)
			}
			return nil
		})
	}

	group.Go(func() error {
		procScanner, err := procnet.NewProcNetScanner(ctx, portTracker, procNetScanInterval)
		if err != nil {
			return fmt.Errorf("scanning /proc/net/{tcp, udp} failed: %w", err)
		}
		return procScanner.ForwardPorts()
	})

	if err := group.Wait(); err != nil {
		log.Fatal(err)
	}

	log.Info("Rancher Desktop Agent Shutting Down")
}

func tryConnectAPI(ctx context.Context, socketFile string, verify func(context.Context) error) error {
	socketRetry := time.NewTicker(socketInterval)
	defer socketRetry.Stop()
	// it can potentially take a few minutes to start RD
	ctxTimeout, cancel := context.WithTimeout(ctx, socketRetryTimeout)
	defer cancel()

	for {
		select {
		case <-ctxTimeout.Done():
			return fmt.Errorf("tryConnectAPI failed: %w", ctxTimeout.Err())
		case <-socketRetry.C:
			log.Debugf("checking if container engine API is running at %s", socketFile)

			if _, err := os.Stat(socketFile); errors.Is(err, os.ErrNotExist) {
				continue
			}

			if err := verify(ctx); err != nil {
				log.Errorf("container engine is not ready yet: %v", err)

				continue
			}

			return nil
		}
	}
}
