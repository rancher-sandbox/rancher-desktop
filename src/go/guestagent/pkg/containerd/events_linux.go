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

// Package containerd handles port binding events from containerd API
package containerd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"github.com/Masterminds/log-go"
	"github.com/containerd/containerd"
	"github.com/containerd/containerd/api/events"
	"github.com/containerd/containerd/namespaces"
	cnutils "github.com/containernetworking/plugins/pkg/utils"
	"github.com/docker/go-connections/nat"
	"google.golang.org/protobuf/proto"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/utils"
)

const (
	namespaceKey = "nerdctl/namespace"
	portsKey     = "nerdctl/ports"
	networkKey   = "nerdctl/networks"
)

// EventMonitor monitors the Containerd API
// for container events.
type EventMonitor struct {
	containerdClient *containerd.Client
	portTracker      tracker.Tracker
}

// NewEventMonitor creates and returns a new Event Monitor for
// Containerd API. Caller is responsible to make sure that
// Docker engine is up and running.
func NewEventMonitor(
	containerdSock string,
	portTracker tracker.Tracker,
) (*EventMonitor, error) {
	client, err := containerd.New(containerdSock, containerd.WithDefaultNamespace(namespaces.Default))
	if err != nil {
		return nil, err
	}

	return &EventMonitor{
		containerdClient: client,
		portTracker:      portTracker,
	}, nil
}

// MonitorPorts subscribes to event API
// for container Create/Update/Delete events.
func (e *EventMonitor) MonitorPorts(ctx context.Context) {
	subscribeFilters := []string{
		`topic=="/tasks/start"`,
		`topic=="/containers/update"`,
		`topic=="/tasks/exit"`,
	}
	msgCh, errCh := e.containerdClient.Subscribe(ctx, subscribeFilters...)

	go e.initializeRunningContainers(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Errorf("context cancellation: %v", ctx.Err())

			return
		case envelope := <-msgCh:
			log.Debugf("received an event: %+v", envelope.Topic)

			switch envelope.Topic {
			case "/tasks/start":
				startTask := &events.TaskStart{}

				err := proto.Unmarshal(envelope.Event.GetValue(), startTask)
				if err != nil {
					log.Errorf("failed to unmarshal container's start task: %v", err)
				}

				container, err := e.containerdClient.ContainerService().Get(ctx, startTask.ContainerID)
				if err != nil {
					log.Errorf("failed to get the container %s from namespace %s: %s", startTask.ContainerID, envelope.Namespace, err)
				}
				ports, err := createPortMappingFromString(container.Labels[portsKey])
				if err != nil {
					log.Errorf("failed to create port mapping from container's start task: %v", err)
				}

				if len(ports) == 0 {
					continue
				}
				err = execIptablesRules(ctx, ports, startTask.ContainerID, container.Labels[networkKey], envelope.Namespace, strconv.Itoa(int(startTask.Pid)))
				if err != nil {
					log.Errorf("failed running iptable rules to update DNAT rule in CNI-HOSTPORT-DNAT chain: %v", err)
				}

				err = e.portTracker.Add(startTask.ContainerID, ports)
				if err != nil {
					log.Errorf("adding port mapping to tracker failed: %v", err)

					continue
				}

			case "/containers/update":
				cuEvent := &events.ContainerUpdate{}
				err := proto.Unmarshal(envelope.Event.GetValue(), cuEvent)
				if err != nil {
					log.Errorf("failed to unmarshal container update event: %v", err)
				}

				container, err := e.containerdClient.ContainerService().Get(ctx, cuEvent.ID)
				if err != nil {
					log.Errorf("failed to get the container %s from namespace %s: %s", cuEvent.ID, envelope.Namespace, err)
				}

				ports, err := createPortMappingFromString(container.Labels[portsKey])
				if err != nil {
					log.Errorf("failed to create port mapping from container's start task: %v", err)
				}

				if len(ports) == 0 {
					continue
				}

				existingPortMap := e.portTracker.Get(cuEvent.ID)
				if existingPortMap != nil {
					if !reflect.DeepEqual(ports, existingPortMap) {
						err := e.portTracker.Remove(cuEvent.ID)
						if err != nil {
							log.Errorf("failed to remove port mapping from container update event: %v", err)
						}

						err = e.portTracker.Add(cuEvent.ID, ports)
						if err != nil {
							log.Errorf("failed to add port mapping from container update event: %v", err)

							continue
						}
					}

					continue
				}
				// Not 100% sure if we ever get here...
				if err = e.portTracker.Add(cuEvent.ID, ports); err != nil {
					log.Errorf("failed to add port mapping from container update event: %v", err)
				}

			case "/tasks/exit":
				exitTask := &events.TaskExit{}
				err := proto.Unmarshal(envelope.Event.GetValue(), exitTask)
				if err != nil {
					log.Errorf("failed to unmarshal container's exit task: %v", err)
				}

				container, err := e.containerdClient.LoadContainer(ctx, exitTask.ContainerID)
				if err != nil {
					log.Errorf("failed to get the container %s from namespace %s: %s", exitTask.ContainerID, envelope.Namespace, err)
				}

				tsk, err := container.Task(ctx, nil)
				if err != nil {
					log.Errorf("failed to get the task for container %s: %s", exitTask.ContainerID, err)
				}
				status, err := tsk.Status(ctx)
				if err != nil {
					log.Errorf("failed to get the task status for container %s: %s", exitTask.ContainerID, err)
				}

				if status.Status == containerd.Running {
					log.Debugf("container %s is still running, but received exit event with status %d", exitTask.ContainerID, exitTask.ExitStatus)
					continue
				}

				portMapToDelete := e.portTracker.Get(exitTask.ContainerID)
				if portMapToDelete != nil {
					err = e.portTracker.Remove(exitTask.ContainerID)
					if err != nil {
						log.Errorf("removing port mapping from tracker failed: %v", err)
					}
				}
			}

		case err := <-errCh:
			log.Errorf("receiving container event failed: %v", err)

			return
		}
	}
}

// IsServing returns true if the client can successfully connect to the
// containerd daemon and the healthcheck service returns the SERVING
// response.
// This call will block if a transient error is encountered during
// connection. A timeout can be set in the context to ensure it returns
// early.
func (e *EventMonitor) IsServing(ctx context.Context) error {
	serving, err := e.containerdClient.IsServing(ctx)
	if serving {
		return nil
	}

	return fmt.Errorf("containerd API is not serving: %w", err)
}

// initializeRunningContainers calls the API to get a list of all existing
// containers. If the port monitoring misses any /tasks/start events during
// startup or due to timing issues, this acts as a backup to capture all
// previously running containers.
func (e *EventMonitor) initializeRunningContainers(ctx context.Context) {
	containers, err := e.containerdClient.Containers(ctx)
	if err != nil {
		log.Errorf("failed getting containers: %s", err)
		return
	}
	for _, c := range containers {
		// skip already added containers
		if len(e.portTracker.Get(c.ID())) != 0 {
			continue
		}
		t, err := c.Task(ctx, nil)
		if err != nil {
			log.Errorf("failed getting container %s task: %s", c.ID(), err)
			continue
		}

		status, err := t.Status(ctx)
		if err != nil {
			log.Errorf("failed getting container %s task status: %s", c.ID(), err)
			continue
		}
		if status.Status != containerd.Running {
			continue
		}
		labels, err := c.Labels(ctx)
		if err != nil {
			log.Errorf("failed getting container %s labels: %s", c.ID(), err)
			continue
		}

		ports, err := createPortMappingFromString(labels[portsKey])
		if err != nil {
			log.Errorf("failed to create port mapping for container %s: %v", c.ID(), err)
		}
		if len(ports) == 0 {
			continue
		}

		err = execIptablesRules(ctx, ports, c.ID(), labels[networkKey], labels[namespaceKey], strconv.Itoa(int(t.Pid())))
		if err != nil {
			log.Errorf("failed running iptable rules to update DNAT rule in CNI-HOSTPORT-DNAT chain: %v", err)
		}

		err = e.portTracker.Add(c.ID(), ports)
		if err != nil {
			log.Errorf("adding port mapping to tracker failed: %v", err)

			continue
		}

		log.Debugf("initialized container %s task status: %+v with ports: %+v", c.ID(), status, ports)
	}
}

// Close closes the client connection to the API server.
func (e *EventMonitor) Close() error {
	var finalErr error

	if err := e.containerdClient.Close(); err != nil {
		finalErr = fmt.Errorf("failed to close containerd client: %w", err)
	}

	if err := e.portTracker.RemoveAll(); err != nil {
		finalErr = fmt.Errorf("failed to remove all ports from port tracker: %w", err)

		return finalErr
	}

	return finalErr
}

// execIptablesRules creates an additional DNAT rule to allow service exposure on
// other network addresses if port binding is bound to 127.0.0.1.
func execIptablesRules(ctx context.Context, portMappings nat.PortMap, containerID, networks, namespace, pid string) error {
	var errs []error

	var containerNetworks []string
	err := json.Unmarshal([]byte(networks), &containerNetworks)
	if err != nil {
		errs = append(errs, fmt.Errorf("unmarshaling container networks: %w", err))
		return errors.Join(errs...)
	}
	for portProto, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			if portBinding.HostIP == "127.0.0.1" {
				err := createLoopbackIPtablesRules(
					ctx,
					containerNetworks,
					containerID,
					namespace,
					pid,
					portProto.Port(),
					portBinding.HostPort)
				if err != nil {
					errs = append(errs, err)
				}
			}
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", utils.ErrExecIptablesRule, errs)
	}

	return nil
}

// When the port binding is set to 127.0.0.1, an additional DNAT rule is added to the main
// CNI DNAT chain (CNI-HOSTPORT-DNAT) after the existing rule (using --append). This is necessary
// because the initial CNI rule created by containerd only allows traffic to be routed to localhost.
// To make the service discoverable via the namespaced network's subnet, an additional rule is added
// to allow traffic to any destination IP address. This effectively causes the service to listen on
// the eth0 interface instead of localhost, which is required since the traffic is routed through the
// vm-switch over the tap network.
//
// The existing DNAT rule is as follows:
//
//	DNAT       tcp  --  anywhere             localhost            tcp dpt:9119 to:10.4.0.22:80.
//
// After the existing rule, the following new rule is added:
//
//	DNAT       tcp  --  anywhere             anywhere             tcp dpt:9119 to:10.4.0.22:80.
func createLoopbackIPtablesRules(ctx context.Context, networks []string, containerID, namespace, pid, port, destinationPort string) error {
	eth0IP, err := extractIPAddress(pid)
	if err != nil {
		return err
	}

	log.Debugf("found the ip address: %s for containerID: %s", eth0IP, containerID)
	cID := fmt.Sprintf("%s-%s", namespace, containerID)

	var allErrs []error

	// Run the rule per network
	for _, network := range networks {
		chainName := cnutils.MustFormatChainNameWithPrefix(network, cID, "DN-")

		// Instead of modifying the existing rule, a new rule is added that overrides the previous one.
		// The original rule only allows traffic from anywhere to localhost, but the new rule permits traffic
		// from anywhere to anywhere. The new rule is appended below the existing one in the chain, ensuring
		// that traffic is correctly routed to the specified destination.
		//
		// Example of the new rule:
		//   iptables -t nat -A CNI-DN-xxxxxx -p tcp -d 0.0.0.0/0 -j DNAT --dport 9119 --to-destination 10.4.0.10:80
		//
		// IMPORTANT: Unlike the Docker events API, we do not attempt to delete the rules we create. This is due
		// to how containerd manages CNI chains. Specifically, containerd deletes the entire CNI chain (e.g., CNI-DN-xxxxxx)
		// when a container exits or is deleted, which automatically removes any rules appended during container startup.
		iptableCmd := exec.CommandContext(ctx,
			"iptables",
			"--table", "nat",
			"--append", chainName,
			"--protocol", "tcp",
			"--destination", "0.0.0.0/0",
			"--jump", "DNAT",
			"--dport", destinationPort,
			"--to-destination", fmt.Sprintf("%s:%s", eth0IP, port))
		var stderr bytes.Buffer
		iptableCmd.Stderr = &stderr
		if err := iptableCmd.Run(); err != nil {
			allErrs = append(allErrs, fmt.Errorf("running iptables rule [%s] failed: %w - %s", iptableCmd.String(), err, stderr.String()))
		}
		log.Debugf("running the following loopback rule [%s] in chain: %s for containerID: %s", iptableCmd.String(), chainName, containerID)
	}

	if len(allErrs) != 0 {
		return errors.Join(allErrs...)
	}
	return nil
}

func createPortMappingFromString(portMapping string) (nat.PortMap, error) {
	var ports []Port

	portMap := make(nat.PortMap)

	if portMapping == "" {
		return portMap, nil
	}

	err := json.Unmarshal([]byte(portMapping), &ports)
	if err != nil {
		return nil, err
	}

	for _, port := range ports {
		portMapKey, err := nat.NewPort(strings.ToLower(port.Protocol), strconv.Itoa(port.ContainerPort))
		if err != nil {
			return nil, err
		}

		portBinding := nat.PortBinding{
			HostIP:   utils.NormalizeHostIP(port.HostIP),
			HostPort: strconv.Itoa(port.HostPort),
		}
		if pb, ok := portMap[portMapKey]; ok {
			portMap[portMapKey] = append(pb, portBinding)
		} else {
			portMap[portMapKey] = []nat.PortBinding{portBinding}
		}
	}

	return portMap, nil
}

func extractIPAddress(pid string) (string, error) {
	// retrieve the eth0 IP address from the container
	nsenterInfIPCmd := exec.Command("nsenter", "-t", pid, "-n", "ip", "-o", "-4", "addr", "show", "dev", "eth0")
	output, err := nsenterInfIPCmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	// Regular expression pattern to match the IP address
	rx := regexp.MustCompile(`\binet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/\d{1,2}`)

	matches := rx.FindStringSubmatch(string(output))
	segments := 2
	if len(matches) < segments {
		return "", utils.ErrIPAddressNotFound
	}

	return matches[1], nil
}

// Port is representing nerdctl/ports entry in the
// event envelope's labels.
type Port struct {
	HostPort      int
	ContainerPort int
	Protocol      string
	HostIP        string
}
