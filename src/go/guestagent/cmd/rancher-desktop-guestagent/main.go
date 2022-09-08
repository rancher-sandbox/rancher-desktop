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

// Rancher-desktop-guestagent implements an agent that runs instead of the
// Rancher Desktop VM (whether WSL-based on Windows, or Lima-based on mac/Linux).
// It is currently used to handle port forwarding issues.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/docker"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/iptables"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/kube"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tcplistener"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
	"golang.org/x/sync/errgroup"
)

//nolint:gochecknoglobals
var (
	debug            = flag.Bool("debug", false, "display debug output")
	configPath       = flag.String("kubeconfig", "/etc/rancher/k3s/k3s.yaml", "path to kubeconfig")
	enableIptables   = flag.Bool("iptables", true, "enable iptables scanning")
	enableKubernetes = flag.Bool("kubernetes", false, "enable Kubernetes service forwarding")
	enableDocker     = flag.Bool("docker", false, "enable Docker event monitoring")
)

const (
	iptablesUpdateInterval   = 3 * time.Second
	dockerSocketInterval     = 5 * time.Second
	dockerSocketRetryTimeout = 2 * time.Minute
	dockerSocketFile         = "/var/run/docker.sock"
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

	group, ctx := errgroup.WithContext(context.Background())
	if *enableDocker {
		group.Go(func() error {
			portTracker := tracker.NewPortTracker()
			eventMonitor, err := docker.NewEventMonitor(portTracker)
			if err != nil {
				return fmt.Errorf("error initializing docker event monitor: %w", err)
			}
			if err := tryConnectDocker(ctx, eventMonitor.Info); err != nil {
				return err
			}
			eventMonitor.MonitorPorts(ctx)

			return nil
		})
	}

	tracker := tcplistener.NewListenerTracker()

	if *enableIptables {
		group.Go(func() error {
			// Forward ports
			err := iptables.ForwardPorts(ctx, tracker, iptablesUpdateInterval)
			if err != nil {
				return fmt.Errorf("error mapping ports: %w", err)
			}

			return nil
		})
	}

	if *enableKubernetes {
		group.Go(func() error {
			// Watch for kube
			err := kube.WatchForNodePortServices(ctx, tracker, *configPath)
			if err != nil {
				return fmt.Errorf("error watching services: %w", err)
			}

			return nil
		})
	}

	if err := group.Wait(); err != nil {
		log.Fatal(err)
	}

	log.Info("Rancher Desktop Agent Shutting Down")
}

func tryConnectDocker(ctx context.Context, verify func(context.Context) error) error {
	dockerSocketRetry := time.NewTicker(dockerSocketInterval)
	defer dockerSocketRetry.Stop()
	// it can potentially take a few minutes to start RD
	ctxTimeout, cancel := context.WithTimeout(ctx, dockerSocketRetryTimeout)
	defer cancel()

	for {
		select {
		case <-ctxTimeout.Done():
			return fmt.Errorf("tryConnectDockerEngine failed: %w", ctxTimeout.Err())
		case <-dockerSocketRetry.C:
			log.Debugf("checking if docker engine is running at %s", dockerSocketFile)

			if _, err := os.Stat(dockerSocketFile); errors.Is(err, os.ErrNotExist) {
				continue
			}

			if err := verify(ctx); err != nil {
				log.Errorf("docker engine is not ready yet: %v", err)

				continue
			}

			return nil
		}
	}
}
