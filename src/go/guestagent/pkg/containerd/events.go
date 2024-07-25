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
	"context"
	"crypto/sha512"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os/exec"
	"reflect"
	"regexp"
	"strconv"

	"github.com/Masterminds/log-go"
	"github.com/containerd/containerd"
	"github.com/containerd/containerd/api/events"
	containerdNamespace "github.com/containerd/containerd/namespaces"
	"github.com/docker/go-connections/nat"
	"github.com/gogo/protobuf/proto"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

const (
	namespaceKey   = "nerdctl/namespace"
	portsKey       = "nerdctl/ports"
	maxHashLen     = sha512.Size * 2
	maxChainLength = 28
	chainPrefix    = "CNI-"
)

var (
	ErrExecIptablesRule  = errors.New("failed updating iptables rules")
	ErrIPAddressNotFound = errors.New("IP address not found in line")
)

// EventMonitor monitors the Containerd API
// for container events.
type EventMonitor struct {
	containerdClient        *containerd.Client
	portTracker             tracker.Tracker
	enablePrivilegedService bool
}

// NewEventMonitor creates and returns a new Event Monitor for
// Containerd API. Caller is responsible to make sure that
// Docker engine is up and running.
func NewEventMonitor(
	containerdSock string,
	portTracker tracker.Tracker,
	enablePrivilegedService bool,
) (*EventMonitor, error) {
	client, err := containerd.New(containerdSock, containerd.WithDefaultNamespace(containerdNamespace.Default))
	if err != nil {
		return nil, err
	}

	return &EventMonitor{
		containerdClient:        client,
		portTracker:             portTracker,
		enablePrivilegedService: enablePrivilegedService,
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

				ports, err := e.createPortMapping(ctx, envelope.Namespace, startTask.ContainerID)
				if err != nil {
					log.Errorf("failed to create port mapping from container's start task: %v", err)
				}

				if len(ports) == 0 {
					continue
				}

				err = execIptablesRules(ports, startTask.ContainerID, envelope.Namespace, strconv.Itoa(int(startTask.Pid)))
				if err != nil {
					log.Errorf("failed running iptable rules to update DNAT rule in CNI-HOSTPORT-DNAT chain: %v", err)
				}

				err = e.portTracker.Add(startTask.ContainerID, ports)
				if err != nil {
					log.Errorf("adding port mapping to tracker failed: %v", err)

					continue
				}

				e.updateListener(ctx, ports, e.portTracker.AddListener)

			case "/containers/update":
				cuEvent := &events.ContainerUpdate{}
				err := proto.Unmarshal(envelope.Event.GetValue(), cuEvent)
				if err != nil {
					log.Errorf("failed to unmarshal container update event: %v", err)
				}

				ports, err := e.createPortMapping(ctx, envelope.Namespace, cuEvent.ID)
				if err != nil {
					log.Errorf("failed to create port mapping from container update event: %v", err)
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

						e.updateListener(ctx, ports, e.portTracker.RemoveListener)
						err = e.portTracker.Add(cuEvent.ID, ports)
						if err != nil {
							log.Errorf("failed to add port mapping from container update event: %v", err)

							continue
						}

						e.updateListener(ctx, ports, e.portTracker.AddListener)
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

				portMapToDelete := e.portTracker.Get(exitTask.ContainerID)
				if portMapToDelete != nil {
					err = e.portTracker.Remove(exitTask.ContainerID)
					if err != nil {
						log.Errorf("removing port mapping from tracker failed: %v", err)
					}
				}

				e.updateListener(ctx, portMapToDelete, e.portTracker.RemoveListener)
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

		err = execIptablesRules(ports, c.ID(), labels[namespaceKey], strconv.Itoa(int(t.Pid())))
		if err != nil {
			log.Errorf("failed running iptable rules to update DNAT rule in CNI-HOSTPORT-DNAT chain: %v", err)
		}

		err = e.portTracker.Add(c.ID(), ports)
		if err != nil {
			log.Errorf("adding port mapping to tracker failed: %v", err)

			continue
		}

		e.updateListener(ctx, ports, e.portTracker.AddListener)
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

func (e *EventMonitor) updateListener(
	ctx context.Context,
	portMappings nat.PortMap,
	action func(context.Context, net.IP, int) error,
) {
	// Only create listeners for the default network when the PrivilegedService is enabled.
	// Otherwise, creating listeners can conflict with the proxy listeners that are created
	// by the namespaced network’s port exposing API.
	if !e.enablePrivilegedService {
		return
	}

	for _, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			port, err := strconv.Atoi(portBinding.HostPort)
			if err != nil {
				log.Errorf("port conversion for [%+v] error: %v", portBinding, err)

				continue
			}

			// We always need to use INADDR_ANY here since any other addresses used here
			// can cause a wrong entry in iptables and will not be routable.
			if err := action(ctx, net.IPv4zero, port); err != nil {
				log.Errorf("updating listener for IP: [%s] and Port: [%s] failed: %v",
					net.IPv4zero,
					portBinding.HostPort,
					err)

				continue
			}
		}
	}
}

// execIptablesRules creates an additional DNAT rule to allow service exposure on
// other network addresses if port binding is bound to 127.0.0.1.
func execIptablesRules(portMappings nat.PortMap, containerID, namespace, pid string) error {
	var errs []error

	for portProto, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			if portBinding.HostIP == "127.0.0.1" {
				err := createLoopbackIPtablesRules(containerID, namespace, pid, portProto.Port(), portBinding.HostPort)
				if err != nil {
					errs = append(errs, err)
				}
			}
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrExecIptablesRule, errs)
	}

	return nil
}

// When the port binding is bound to 127.0.0.1, we add an additional DNAT rule in the main
// CNI DNAT chain (CNI-HOSTPORT-DNAT) after the existing rule (using --append).
// This is necessary because the initial CNI rule created by containerd only allows the traffic
// to be routed to localhost. Therefore, we add an additional rule to allow traffic to any
// destination IP address which allows the service to be discoverable through namespaced network's
// subnet, which essentially causes the service to listen on eth0 instead; this is required as the
// traffic is routed via vm-switch over the tap network.
// The existing DNAT rule are as follows:
// DNAT       tcp  --  anywhere             localhost            tcp dpt:9119 to:10.4.0.22:80.
// We enter the following rule after the existing rule:
// DNAT       tcp  --  anywhere             anywhere             tcp dpt:9119 to:10.4.0.22:80.
func createLoopbackIPtablesRules(containerID, namespace, pid, port, destinationPort string) error {
	// read the container's cni config to extract the network name
	nsenterNetworkConfCmd := exec.Command("nsenter", "-t", pid, "-n", "cat", "/etc/cni/net.d/nerdctl-bridge.conflist")
	output, err := nsenterNetworkConfCmd.CombinedOutput()
	if err != nil {
		return err
	}

	log.Debugf("read the following network conflist for containerID: %s config: %s", containerID, string(output))

	var networkConfig cniNetworkConfig
	err = json.Unmarshal(output, &networkConfig)
	if err != nil {
		return err
	}

	eth0IP, err := extractIPAddress(pid)
	if err != nil {
		return err
	}

	log.Debugf("found the ip address: %s for containerID: %s", eth0IP, containerID)

	// create the corresponding chain name, e.g CNI-DN-xxxxxx
	// (where xxxxxx is a function of the ContainerID and network name)
	// https://www.cni.dev/plugins/current/meta/portmap/#dnat
	// https://github.com/containernetworking/plugins/blob/2b097c5a62dacfd2f9ea4268faa4fc04bd5343f5/pkg/utils/utils.go#L39
	cID := fmt.Sprintf("%s-%s", namespace, containerID)
	chainName := mustFormatHashWithPrefix(maxChainLength, chainPrefix+"DN-", networkConfig.Name+cID)

	log.Debugf("determined iptables chain name: %s for containerID: %s", chainName, containerID)

	// Instead of updating the existing rule we insert the overriding rule below the previous one
	// e.g rule can be:
	// iptables -t nat -A CNI-DN-xxxxxx -p tcp -d 0.0.0.0/0 -j DNAT --dport 9119 --to-destination 10.4.0.10:80
	iptableCmd := exec.Command("iptables",
		"--table", "nat",
		"--append", chainName,
		"--protocol", "tcp",
		"--destination", "0.0.0.0/0",
		"--jump", "DNAT",
		"--dport", destinationPort,
		"--to-destination", fmt.Sprintf("%s:%s", eth0IP, port))

	return iptableCmd.Run()
}

func (e *EventMonitor) createPortMapping(ctx context.Context, namespace, containerID string) (nat.PortMap, error) {
	container, err := e.containerdClient.ContainerService().Get(
		containerdNamespace.WithNamespace(ctx, namespace), containerID)
	if err != nil {
		return nil, err
	}

	log.Debugf("got a container [%s] from namespace [%s]", container.ID, namespace)

	return createPortMappingFromString(container.Labels[portsKey])
}

func createPortMappingFromString(portMapping string) (nat.PortMap, error) {
	var ports []Port

	portMap := make(nat.PortMap)

	if len(portMapping) == 0 {
		return portMap, nil
	}

	err := json.Unmarshal([]byte(portMapping), &ports)
	if err != nil {
		return nil, err
	}

	for _, port := range ports {
		portMapKey, err := nat.NewPort(port.Protocol, strconv.Itoa(port.ContainerPort))
		if err != nil {
			return nil, err
		}

		portBinding := nat.PortBinding{
			HostIP:   port.HostIP,
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
	rx := regexp.MustCompile(`\binet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/\d{1,2}`)

	matches := rx.FindStringSubmatch(string(output))
	segments := 2
	if len(matches) < segments {
		return "", ErrIPAddressNotFound
	}

	return matches[1], nil
}

// ported from:
// https://github.com/containernetworking/plugins/blob/2b097c5a62dacfd2f9ea4268faa4fc04bd5343f5/pkg/utils/utils.go#L39
// however module requires Go 1.20
// mustFormatHashWithPrefix returns a string of given length that begins with the
// given prefix. It is filled with entropy based on the given string toHash.
func mustFormatHashWithPrefix(length int, prefix string, toHash string) string {
	if len(prefix) >= length || length > maxHashLen {
		panic("invalid length")
	}

	output := sha512.Sum512([]byte(toHash))

	return fmt.Sprintf("%s%x", prefix, output)[:length]
}

// Port is representing nerdctl/ports entry in the
// event envelope's labels.
type Port struct {
	HostPort      int
	ContainerPort int
	Protocol      string
	HostIP        string
}

type cniNetworkConfig struct {
	CNIVersion    string            `json:"cniVersion"`
	Name          string            `json:"name"`
	NerdctlID     string            `json:"nerdctlId"`
	NerdctlLabels map[string]string `json:"nerdctlLabels"`
}
