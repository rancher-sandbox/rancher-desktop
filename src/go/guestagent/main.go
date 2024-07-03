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
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
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
	vtunnelAddr             = flag.String("vtunnelAddr", vtunnelPeerAddr, "peer address for Vtunnel in IP:PORT format")
	enablePrivilegedService = flag.Bool("privilegedService", false, "enable Privileged Service mode")
	k8sServiceListenerAddr  = flag.String("k8sServiceListenerAddr", net.IPv4zero.String(),
		"address to bind Kubernetes services to on the host, valid options are 0.0.0.0 or 127.0.0.1")
	adminInstall = flag.Bool("adminInstall", false, "indicates if Rancher Desktop is installed as admin or not")
	k8sAPIPort   = flag.String("k8sAPIPort", "6443",
		"K8sAPI port number to forward to rancher-desktop wsl-proxy as a static portMapping event")
)

// Flags can only be enabled in the following combination:
// +======================+==============================================+
// |                      |     Default Network    | Namespaced Network  |
// +----------------------+------------------------+---------------------+
// |                      | Admin      | Non-Admin | Admin   | Non-Admin |
// +======================+============+===========+=========+===========+
// | privilegedService    | enable     | disable   | disable | disable   |
// +----------------------+------------+-----------+---------+-----------+
// | docker Or containerd | enable     | disable   | enable  | enable    |
// +----------------------+------------+-----------+---------+-----------+
// | iptables             | disable or | enable    | disable | disable   |
// |                      | **enable   |           |         |           |
// +----------------------+------------+-----------+---------+-----------+
// ** iptables can be enable for the default network with admin when older
// versions of k8s are used that do not support the service watcher API.

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
		!*enableDocker &&
		!*enableIptables {
		log.Fatal("requires either -docker, -containerd or -iptables enabled.")
	}

	if *enableContainerd &&
		*enableDocker &&
		*enableIptables {
		log.Fatal("requires either -docker, -containerd or -iptables, not all.")
	}

	var portTracker tracker.Tracker

	if *enablePrivilegedService {
		if *vtunnelAddr == "" {
			log.Fatal("-vtunnelAddr must be provided when -privilegedService is enabled.")
		}

		wslAddr, err := getWSLAddr(wslInfName)
		if err != nil {
			log.Fatalf("failure getting WSL IP addresses: %v", err)
		}

		forwarder := forwarder.NewVTunnelForwarder(*vtunnelAddr)
		portTracker = tracker.NewVTunnelTracker(forwarder, wslAddr)
	} else {
		forwarder := forwarder.NewWSLProxyForwarder("/run/wsl-proxy.sock")
		portTracker = tracker.NewAPITracker(forwarder, tracker.GatewayBaseURL, *adminInstall)
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
	}

	if *enableContainerd {
		group.Go(func() error {
			eventMonitor, err := containerd.NewEventMonitor(*containerdSock, portTracker, *enablePrivilegedService)
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
		group.Go(func() error {
			k8sServiceListenerIP := net.ParseIP(*k8sServiceListenerAddr)

			if k8sServiceListenerIP == nil || !(k8sServiceListenerIP.Equal(net.IPv4zero) ||
				k8sServiceListenerIP.Equal(net.IPv4(127, 0, 0, 1))) {
				log.Fatalf("empty or none valid input for Kubernetes service listener IP address %s. "+
					"Valid options are 0.0.0.0 and 127.0.0.1.", *k8sServiceListenerAddr)
			}

			// listenerOnlyMode represents when iptables is enabled and privileged services
			// and admin install are disabled; this typically indicates a non-admin installation
			// of the legacy network, requiring listeners only. In listenerOnlyMode, we create
			// TCP listeners on 127.0.0.1 to enable automatic port forwarding mechanisms,
			// particularly in WSLv2 environments.
			listenerOnlyMode := *enableIptables && !*enablePrivilegedService && !*adminInstall
			// Watch for kube
			err := kube.WatchForServices(ctx,
				*configPath,
				k8sServiceListenerIP,
				listenerOnlyMode,
				portTracker)
			if err != nil {
				return fmt.Errorf("error watching services: %w", err)
			}

			return nil
		})
	}

	if *enableIptables {
		group.Go(func() error {
			err := iptables.ForwardPorts(ctx, portTracker, iptablesUpdateInterval)
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
