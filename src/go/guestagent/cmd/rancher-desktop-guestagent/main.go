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
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/containerd"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/docker"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/forwarder"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/iptables"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/kube"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tcplistener"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"golang.org/x/sync/errgroup"
)

//nolint:gochecknoglobals
var (
	debug            = flag.Bool("debug", false, "display debug output")
	configPath       = flag.String("kubeconfig", "/etc/rancher/k3s/k3s.yaml", "path to kubeconfig")
	enableIptables   = flag.Bool("iptables", true, "enable iptables scanning")
	enableKubernetes = flag.Bool("kubernetes", false, "enable Kubernetes service forwarding")
	enableDocker     = flag.Bool("docker", false, "enable Docker event monitoring")
	enableContainerd = flag.Bool("containerd", false, "enable Containerd event monitoring")
	containerdSock   = flag.String("containerdSock",
		containerdSocketFile,
		"file path for Containerd socket address")
	vtunnelAddr             = flag.String("vtunnelAddr", vtunnelPeerAddr, "Peer address for Vtunnel in IP:PORT format")
	enablePrivilegedService = flag.Bool("privilegedService", false, "enable Privileged Service mode")
	k8sServiceListenerAddr  = flag.String("k8sServiceListenerAddr", net.IPv4zero.String(),
		"address to bind Kubernetes services to on the host, valid options are 0.0.0.0 or 127.0.0.1")
)

const (
	wslInfName             = "eth0"
	iptablesUpdateInterval = 3 * time.Second
	socketInterval         = 5 * time.Second
	socketRetryTimeout     = 2 * time.Minute
	dockerSocketFile       = "/var/run/docker.sock"
	containerdSocketFile   = "/run/k3s/containerd/containerd.sock"
	vtunnelPeerAddr        = "127.0.0.1:3040"
)

func main() {
	// Setup logging with debug and trace levels
	logger := log.NewStandard()

	flag.Parse()

	if *debug {
		logger.Level = log.DebugLevel
	}

	log.Current = logger

	log.Info("Starting Rancher Desktop Agent")

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

	tcpTracker := tcplistener.NewListenerTracker()

	wslAddr, err := getWSLAddr(wslInfName)
	if err != nil {
		log.Fatalf("failure getting WSL IP addresses: %v", err)
	}

	forwarder := forwarder.NewVtunnelForwarder(*vtunnelAddr)
	portTracker := tracker.NewPortTracker(forwarder, wslAddr)

	if *enablePrivilegedService {
		if !*enableContainerd && !*enableDocker {
			log.Fatal("-privilegedService mode requires either -docker or -containerd enabled.")
		}

		if *enableContainerd && *enableDocker {
			log.Fatal("-privilegedService mode requires either -docker or -containerd, not both.")
		}

		if *vtunnelAddr == "" {
			log.Fatal("-vtunnelAddr must be provided when docker is enabled.")
		}

		if *enableContainerd {
			group.Go(func() error {
				eventMonitor, err := containerd.NewEventMonitor(*containerdSock, portTracker, tcpTracker)
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
	}

	if *enableKubernetes {
		group.Go(func() error {
			k8sServiceListenerIP := net.ParseIP(*k8sServiceListenerAddr)

			if k8sServiceListenerIP == nil || !(k8sServiceListenerIP.Equal(net.IPv4zero) ||
				k8sServiceListenerIP.Equal(net.IPv4(127, 0, 0, 1))) { //nolint:gomnd // IPv4 addr localhost
				log.Fatalf("empty or none valid input for Kubernetes service listener IP address %s. "+
					"Valid options are 0.0.0.0 and 127.0.0.1.", *k8sServiceListenerAddr)
			}

			// Watch for kube
			err := kube.WatchForServices(ctx,
				*configPath,
				k8sServiceListenerIP,
				*enablePrivilegedService,
				portTracker,
				tcpTracker)
			if err != nil {
				return fmt.Errorf("error watching services: %w", err)
			}

			return nil
		})
	}

	if *enableIptables {
		group.Go(func() error {
			// Forward ports
			err := iptables.ForwardPorts(ctx, tcpTracker, iptablesUpdateInterval)
			if err != nil {
				return fmt.Errorf("error mapping ports: %w", err)
			}

			return nil
		})
	}

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

// Gets the wsl interface address by doing a lookup by name
// for wsl we do a lookup for 'eth0'.
func getWSLAddr(infName string) ([]types.ConnectAddrs, error) {
	inf, err := net.InterfaceByName(infName)
	if err != nil {
		return nil, err
	}

	addrs, err := inf.Addrs()
	if err != nil {
		return nil, err
	}

	connectAddrs := make([]types.ConnectAddrs, 0)

	for _, addr := range addrs {
		connectAddrs = append(connectAddrs, types.ConnectAddrs{
			Network: addr.Network(),
			Addr:    addr.String(),
		})
	}

	return connectAddrs, nil
}
