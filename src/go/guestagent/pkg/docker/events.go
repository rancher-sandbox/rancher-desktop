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
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/Masterminds/log-go"
	"github.com/docker/docker/api/types"
	containerapi "github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

// EventMonitor monitors the Docker engine's Event API
// for container events.
type EventMonitor struct {
	dockerClient *client.Client
	portTracker  tracker.Tracker
	// map of containerID to iptables rule entry to remove from DOCKER chain
	iptablesRulesToDelete map[string]*exec.Cmd
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
		dockerClient:          cli,
		portTracker:           portTracker,
		iptablesRulesToDelete: make(map[string]*exec.Cmd),
	}, nil
}

// MonitorPorts scans Docker's event stream API
// for container start/stop events.
func (e *EventMonitor) MonitorPorts(ctx context.Context) {
	msgCh, errCh := e.dockerClient.Events(ctx, events.ListOptions{
		Filters: filters.NewArgs(
			filters.Arg("type", string(types.ContainerObject)),
			filters.Arg("event", string(events.ActionStart)),
			filters.Arg("event", string(events.ActionStop)),
			filters.Arg("event", string(events.ActionDie))),
	})

	if err := e.initializeRunningContainers(ctx); err != nil {
		log.Errorf("failed to initialize existing container port mappings: %s", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Errorf("context cancellation: %s", ctx.Err())

			return
		case event := <-msgCh:
			container, err := e.dockerClient.ContainerInspect(ctx, event.Actor.ID)
			if err != nil {
				log.Errorf("inspecting container [%v] failed: %s", event.Actor.ID, err)

				continue
			}

			log.Debugf("received an event: {Status: %+v ContainerID: %+v Ports: %+v}",
				event.Action,
				event.Actor.ID,
				container.NetworkSettings.Ports)

			switch event.Action {
			case events.ActionStart:
				if len(container.NetworkSettings.Ports) != 0 {
					validatePortMapping(container.NetworkSettings.Ports)
					err = e.portTracker.Add(container.ID, container.NetworkSettings.Ports)
					if err != nil {
						log.Errorf("adding port mapping to tracker failed: %s", err)
					}

					e.createIptablesRuleForContainer(ctx, container)
				}
			case events.ActionStop, events.ActionDie:
				err := e.portTracker.Remove(container.ID)
				if err != nil {
					log.Errorf("remove port mapping from tracker failed: %s", err)
				}
				if deleteIptablesCmd, ok := e.iptablesRulesToDelete[container.ID]; ok {
					log.Debugf("removing the following rules from iptables: %s", deleteIptablesCmd.String())
					var stderr bytes.Buffer
					deleteIptablesCmd.Stderr = &stderr
					if err := deleteIptablesCmd.Run(); err != nil {
						log.Errorf("deleting loopback iptables rule failed: %s [%s]", err, stderr.String())
					}
					delete(e.iptablesRulesToDelete, container.ID)
				}
			}
		case err := <-errCh:
			log.Errorf("receiving container event failed: %s", err)

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
	containers, err := e.dockerClient.ContainerList(ctx, containerapi.ListOptions{
		Filters: filters.NewArgs(filters.Arg("status", "running")),
	})
	if err != nil {
		return err
	}

	for i := range containers {
		container := &containers[i]
		if len(container.Ports) != 0 {
			portMap, err := createPortMapping(container.Ports)
			if err != nil {
				log.Errorf("creating initial port mapping failed: %v", err)

				continue
			}
			if err := e.portTracker.Add(container.ID, portMap); err != nil {
				log.Errorf("registering already running containers failed: %v", err)
				continue
			}
			for _, netSettings := range container.NetworkSettings.Networks {
				err = e.createLoopbackIPtablesRules(ctx, container.ID, netSettings.IPAddress, portMap)
				if err != nil {
					log.Errorf("creating iptable rules to update DNAT rule in DOCKER chain during container initialization failed: %v", err)
				}
			}
		}
	}

	return nil
}

func createPortMapping(ports []containerapi.Port) (nat.PortMap, error) {
	portMap := make(nat.PortMap)

	for _, port := range ports {
		if port.IP == "" || port.PublicPort == 0 {
			continue
		}

		portMapKey, err := nat.NewPort(strings.ToLower(port.Type), strconv.Itoa(int(port.PrivatePort)))
		if err != nil {
			return nil, err
		}

		portBinding := nat.PortBinding{
			HostIP:   utils.NormalizeHostIP(port.IP),
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

// When the port binding is bound to 127.0.0.1, an additional DNAT rule is added to the
// main DOCKER chain after the existing rule (using --append). This is necessary because
// the initial DOCKER DNAT rule created by Docker only allows traffic to be routed to
// localhost from localhost. To make the service discoverable through the namespaced
// network's subnet, an additional rule is added to allow traffic to any destination IP
// address.
//
// This is required because traffic is routed via the vm-switch over the tap network.
//
// The existing DNAT rule is as follows:
//
//	DNAT       tcp  --  anywhere             localhost            tcp dpt:9119 to:10.4.0.22:80.
//
// The following rule is entered after the existing rule:
//
//	DNAT       tcp  --  anywhere             anywhere             tcp dpt:9119 to:10.4.0.22:80.
func (e *EventMonitor) createLoopbackIPtablesRules(ctx context.Context, containerID, containerIP string, portMappings nat.PortMap) error {
	var errs []error

	for portProto, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			if portBinding.HostIP != "127.0.0.1" {
				continue
			}
			//nolint:gosec // no security concern with the potentially tainted command arguments
			iptableCmd := exec.CommandContext(ctx,
				"iptables",
				"--table", "nat",
				"--append", "DOCKER",
				"--protocol", portProto.Proto(),
				"--destination", "0.0.0.0/0",
				"--jump", "DNAT",
				"--dport", portBinding.HostPort,
				"--to-destination", fmt.Sprintf("%s:%s", containerIP, portProto.Port()))
			var stderr bytes.Buffer
			iptableCmd.Stderr = &stderr
			if err := iptableCmd.Run(); err != nil {
				errs = append(errs, fmt.Errorf("creating loopback rule in DOCKER chain failed: %w [%s]", err, stderr.String()))
				log.Debugf("running the following iptables rule [%s] with the error(s):[%v]", iptableCmd.String(), errs)
			}
			e.iptablesRulesToDelete[containerID] = iptablesDeleteLoopbackRuleCmd(
				ctx,
				portProto.Proto(),
				portBinding.HostPort,
				fmt.Sprintf("%s:%s", containerIP, portProto.Port()))
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", utils.ErrExecIptablesRule, errs)
	}

	return nil
}

func (e *EventMonitor) createIptablesRuleForContainer(ctx context.Context, container containerapi.InspectResponse) {
	// If the container's NetworkSettings.Networks map is not empty, it indicates that the container
	// is connected to a Docker Compose network. In this case, we should inspect the map and
	// configure the loopback address for each container's assigned IP address.
	if len(container.NetworkSettings.Networks) != 0 {
		// delete the IPv6 rule first
		if err := deleteComposeNetworkIPv6Rule(ctx, container.NetworkSettings.Ports); err != nil {
			log.Errorf("removing docker compose IPv6 rule from DOCKER chain failed: %v", err)
		}
		for networkName, network := range container.NetworkSettings.Networks {
			err := e.createLoopbackIPtablesRules(
				ctx,
				container.ID,
				network.IPAddress,
				container.NetworkSettings.Ports)
			if err != nil {
				log.Errorf("creating iptable rules to update DNAT rule in DOCKER chain for docker compose network: %s failed: %v", networkName, err)
			}
		}
	} else {
		err := e.createLoopbackIPtablesRules(
			ctx,
			container.ID,
			container.NetworkSettings.IPAddress,
			container.NetworkSettings.Ports)
		if err != nil {
			log.Errorf("creating iptable rules to update DNAT rule in DOCKER chain failed: %v", err)
		}
	}
}

func iptablesDeleteLoopbackRuleCmd(ctx context.Context, protocol, dport, toDestination string) *exec.Cmd {
	return exec.CommandContext(ctx,
		"iptables",
		"--table", "nat",
		"--delete", "DOCKER",
		"--protocol", protocol,
		"--destination", "0.0.0.0/0",
		"--jump", "DNAT",
		"--dport", dport,
		"--to-destination", toDestination)
}

// Docker Compose, by default, creates the following rules in the DOCKER chain:
//
//	DNAT       tcp  --  anywhere             localhost            tcp dpt:80 to:172.18.0.2:80
//	DNAT       tcp  --  anywhere             anywhere             tcp dpt:80 to::80
//
// The second rule can be problematic because it uses a wildcard IPv6 address (`::`), which can match
// any incoming TCP traffic destined for port 80. Since there may be no service listening on IPv6,
// this can lead to a TCP RST (reset) response sent back to the client.
//
// To prevent this issue, we must delete the IPv6 rule before adding our following custom rule:
//
//	DNAT       tcp  --  anywhere             anywhere             tcp dpt:80 to:172.18.0.2:80
//
// Note: Even if the `enable_ipv6` property is set to `false` in Docker's compose configuration,
// Docker still creates the wildcard IPv6 rule in iptables. Therefore, we need to manually
// remove it to avoid this issue.
func deleteComposeNetworkIPv6Rule(ctx context.Context, portMappings nat.PortMap) error {
	var errs []error

	for portProto, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			if portBinding.HostIP == "127.0.0.1" {
				//nolint:gosec // Inputs are fixed strings or numbers.
				iptableComposeDeleteCmd := exec.CommandContext(ctx,
					"iptables",
					"--table", "nat",
					"--delete", "DOCKER",
					"--protocol", portProto.Proto(),
					"--jump", "DNAT",
					"--dport", portBinding.HostPort,
					"--to-destination", fmt.Sprintf(":%s", portProto.Port()))
				var stderr bytes.Buffer
				iptableComposeDeleteCmd.Stderr = &stderr
				if err := iptableComposeDeleteCmd.Run(); err != nil {
					errs = append(errs, fmt.Errorf("%w [%s]", err, stderr.String()))
					log.Debugf("running the following iptables rule [%s] with the error(s):[%v]", iptableComposeDeleteCmd.String(), errs)
				}
			}
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", utils.ErrExecIptablesRule, errs)
	}

	return nil
}
