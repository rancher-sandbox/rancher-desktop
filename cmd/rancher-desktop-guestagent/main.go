package main

import (
	"flag"
	"os"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/iptables"
)

var debug = flag.Bool("debug", false, "display debug output")

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

	// Forward ports
	err := iptables.ForwardPorts(3 * time.Second)
	if err != nil {
		log.Errorf("Error mapping ports: %s", err)
	}
}
