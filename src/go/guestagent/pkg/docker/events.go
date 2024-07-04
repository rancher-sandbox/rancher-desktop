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

// Package docker handles port binding events from docker events API
package docker

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"

	"github.com/Masterminds/log-go"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/containerd"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

const (
	startEvent = "start"
	stopEvent  = "stop"
	// die event is a confirmation of kill event.
	dieEvent = "die"
)

// EventMonitor monitors the Docker engine's Event API
// for container events.
type EventMonitor struct {
	dockerClient *client.Client
	portTracker  tracker.Tracker
}

// NewEventMonitor creates and returns a new Event Monitor for
// Docker's event API. Caller is responsible to make sure that
// Docker engine is up and running.
func NewEventMonitor(portTracker tracker.Tracker) (*EventMonitor, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}

	return &EventMonitor{
		dockerClient: cli,
		portTracker:  portTracker,
	}, nil
}

// MonitorPorts scans Docker's event stream API
// for container start/stop events.
func (e *EventMonitor) MonitorPorts(ctx context.Context) {
	msgCh, errCh := e.dockerClient.Events(ctx, types.EventsOptions{
		Filters: filters.NewArgs(
			filters.Arg("type", "container"),
			filters.Arg("event", startEvent),
			filters.Arg("event", stopEvent),
			filters.Arg("event", dieEvent)),
	})

	if err := e.initializeRunningContainers(ctx); err != nil {
		log.Errorf("failed to initialize existing container port mappings: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Errorf("context cancellation: %v", ctx.Err())

			return
		case event := <-msgCh:
			container, err := e.dockerClient.ContainerInspect(ctx, event.ID)
			if err != nil {
				log.Errorf("inspecting container [%v] failed: %v", event.ID, err)

				continue
			}

			log.Debugf("received an event: {Status: %+v ContainerID: %+v Ports: %+v}",
				event.Action,
				event.ID,
				container.NetworkSettings.NetworkSettingsBase.Ports)

			switch event.Action {
			case startEvent:
				if len(container.NetworkSettings.NetworkSettingsBase.Ports) != 0 {
					validatePortMapping(container.NetworkSettings.NetworkSettingsBase.Ports)
					err = e.portTracker.Add(container.ID, container.NetworkSettings.NetworkSettingsBase.Ports)
					if err != nil {
						log.Errorf("adding port mapping to tracker failed: %v", err)
					}

					err = createLoopbackIPtablesRules(container.NetworkSettings.DefaultNetworkSettings.IPAddress,
						container.NetworkSettings.NetworkSettingsBase.Ports)
					if err != nil {
						log.Errorf("failed running iptable rules to update DNAT rule in DOCKER chain: %v", err)
					}
				}
			case stopEvent, dieEvent:
				err := e.portTracker.Remove(container.ID)
				if err != nil {
					log.Errorf("remove port mapping from tracker failed: %w", err)
				}
			}
		case err := <-errCh:
			log.Errorf("receiving container event failed: %v", err)

			return
		}
	}
}

// Flush clears all the container port mappings
// out of the port tracker upon shutdown.
func (e *EventMonitor) Flush() {
	err := e.portTracker.RemoveAll()
	if err != nil {
		log.Errorf("Flush received an error to remove all portMappings: %v", err)
	}
}

// Info returns information about the docker server
// it is used to verify that docker engine server is up.
func (e *EventMonitor) Info(ctx context.Context) error {
	_, err := e.dockerClient.Info(ctx)

	return err
}

func (e *EventMonitor) initializeRunningContainers(ctx context.Context) error {
	containers, err := e.dockerClient.ContainerList(ctx, types.ContainerListOptions{
		Filters: filters.NewArgs(filters.Arg("status", "running")),
	})
	if err != nil {
		return err
	}

	for _, container := range containers {
		if len(container.Ports) != 0 {
			portMap, err := createPortMapping(container.Ports)
			if err != nil {
				log.Errorf("creating initial port mapping failed: %v", err)

				continue
			}

			if err := e.portTracker.Add(container.ID, portMap); err != nil {
				log.Errorf("registering already running containers failed: %v", err)
			}

			for _, netSettings := range container.NetworkSettings.Networks {
				err = createLoopbackIPtablesRules(netSettings.IPAddress, portMap)
				if err != nil {
					log.Errorf("failed running iptable rules to update DNAT rule in DOCKER chain: %v", err)
				}
			}
		}
	}

	return nil
}

func createPortMapping(ports []types.Port) (nat.PortMap, error) {
	portMap := make(nat.PortMap)

	for _, port := range ports {
		if port.IP == "" || port.PublicPort == 0 {
			continue
		}

		portMapKey, err := nat.NewPort(port.Type, strconv.Itoa(int(port.PrivatePort)))
		if err != nil {
			return nil, err
		}

		portBinding := nat.PortBinding{
			HostIP:   port.IP,
			HostPort: strconv.Itoa(int(port.PublicPort)),
		}

		if pb, ok := portMap[portMapKey]; ok {
			portMap[portMapKey] = append(pb, portBinding)
		} else {
			portMap[portMapKey] = []nat.PortBinding{portBinding}
		}
	}

	return portMap, nil
}

// Removes entries in port mapping that do not hold any values
// for IP and Port e.g 9000/tcp:[].
func validatePortMapping(portMap nat.PortMap) {
	for k, v := range portMap {
		if len(v) == 0 {
			log.Debugf("removing entry: %v from the portmappings: %v", k, portMap)
			delete(portMap, k)
		}
	}
}

// When the port binding is bound to 127.0.0.1, we add an additional DNAT rule in the main
// DOCKER chain after the existing rule (using --append).
// This is necessary because the initial DOCKER DNAT rule that is created by docker only allows
// the traffic to be routed to localhost from localhost. Therefore, we add an additional rule to
// allow traffic to any destination IP address which allows the service to be discoverable through
// namespaced network's subnet.
// This is required as the traffic is routed via vm-switch over the tap network.
// The existing DNAT rule are as follows:
// DNAT       tcp  --  anywhere             localhost            tcp dpt:9119 to:10.4.0.22:80.
// We enter the following rule after the existing rule:
// DNAT       tcp  --  anywhere             anywhere             tcp dpt:9119 to:10.4.0.22:80.
func createLoopbackIPtablesRules(containerIP string, portMappings nat.PortMap) error {
	var errs []error

	for portProto, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			if portBinding.HostIP == "127.0.0.1" {
				//nolint:gosec // no security concern with the potentially tainted command arguments
				iptableCmd := exec.Command("iptables",
					"--table", "nat",
					"--append", "DOCKER",
					"--protocol", "tcp",
					"--destination", "0.0.0.0/0",
					"--jump", "DNAT",
					"--dport", portBinding.HostPort,
					"--to-destination", fmt.Sprintf("%s:%s", containerIP, portProto.Port()))
				if err := iptableCmd.Run(); err != nil {
					errs = append(errs, err)
				}
			}
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", containerd.ErrExecIptablesRule, errs)
	}

	return nil
}
