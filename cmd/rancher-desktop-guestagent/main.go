package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/iptables"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/kube"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tcplistener"
	"golang.org/x/sync/errgroup"
)

var debug = flag.Bool("debug", false, "display debug output")
var configPath = flag.String("config-path", "/etc/rancher/k3s/k3s.yaml", "path to kubeconfig")
var enableIptables = flag.Bool("iptables", true, "enable iptables scanning")
var enableKubernetes = flag.Bool("kubernetes", false, "enable Kubernetes service forwarding")

func main() {

	// Setup logging with debug and trace levels
	flag.Parse()
	logger := log.NewStandard()
	if *debug {
		logger.Level = log.DebugLevel
	}
	log.Current = logger

	log.Info("Starting Rancher Desktop Agent")

	if os.Geteuid() != 0 {
		log.Fatal("agent must run as root")
	}

	group, ctx := errgroup.WithContext(context.Background())
	tracker := tcplistener.NewListenerTracker(ctx)
	if *enableIptables {
		group.Go(func() error {
			// Forward ports
			err := iptables.ForwardPorts(tracker, 3 * time.Second)
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
