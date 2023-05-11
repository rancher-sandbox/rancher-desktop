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
	"encoding/json"
	"fmt"
	"net"
	"reflect"
	"strconv"

	"github.com/Masterminds/log-go"
	"github.com/containerd/containerd"
	"github.com/containerd/containerd/api/events"
	containerdNamespace "github.com/containerd/containerd/namespaces"
	"github.com/docker/go-connections/nat"
	"github.com/gogo/protobuf/proto"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
)

const portsKey = "nerdctl/ports"

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
	client, err := containerd.New(containerdSock, containerd.WithDefaultNamespace(containerdNamespace.Default))
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
	subcribeFilters := []string{
		`topic=="/tasks/start"`,
		`topic=="/containers/update"`,
		`topic=="/tasks/exit"`,
	}
	msgCh, errCh := e.containerdClient.Subscribe(ctx, subcribeFilters...)

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
				err := proto.Unmarshal(envelope.Event.Value, startTask)
				if err != nil {
					log.Errorf("failed unmarshaling container's start task: %v", err)
				}

				ports, err := e.createPortMapping(ctx, envelope.Namespace, startTask.ContainerID)
				if err != nil {
					log.Errorf("failed to create port mapping from container's start task: %v", err)
				}

				if len(ports) == 0 {
					continue
				}

				err = e.portTracker.Add(startTask.ContainerID, ports)
				if err != nil {
					log.Errorf("adding port mapping to tracker failed: %v", err)

					continue
				}

				updateListener(ctx, ports, e.portTracker.AddListener)

			case "/containers/update":
				cuEvent := &events.ContainerUpdate{}
				err := proto.Unmarshal(envelope.Event.Value, cuEvent)
				if err != nil {
					log.Errorf("failed unmarshaling container update event: %v", err)
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

						updateListener(ctx, ports, e.portTracker.RemoveListener)
						err = e.portTracker.Add(cuEvent.ID, ports)
						if err != nil {
							log.Errorf("failed to add port mapping from container update event: %v", err)

							continue
						}

						updateListener(ctx, ports, e.portTracker.AddListener)
					}

					continue
				}
				// Not 100% sure if we ever get here...
				if err = e.portTracker.Add(cuEvent.ID, ports); err != nil {
					log.Errorf("failed to add port mapping from container update event: %v", err)
				}

			case "/tasks/exit":
				exitTask := &events.TaskExit{}
				err := proto.Unmarshal(envelope.Event.Value, exitTask)
				if err != nil {
					log.Errorf("failed unmarshaling container's exit task: %v", err)
				}

				portMapToDelete := e.portTracker.Get(exitTask.ContainerID)
				if portMapToDelete != nil {
					err = e.portTracker.Remove(exitTask.ContainerID)
					if err != nil {
						log.Errorf("removing port mapping from tracker failed: %v", err)
					}
				}

				updateListener(ctx, portMapToDelete, e.portTracker.RemoveListener)
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

// Close closes the client connection to the API server.
func (e *EventMonitor) Close() error {
	var finalErr error

	if err := e.containerdClient.Close(); err != nil {
		finalErr = fmt.Errorf("failed to close containerd client: %w", err)
	}

	if err := e.portTracker.RemoveAll(); err != nil {
		if finalErr != nil {
			finalErr = fmt.Errorf("%w; failed to remove all ports from port tracker: %w", finalErr, err)
		} else {
			finalErr = fmt.Errorf("failed to remove all ports from port tracker: %w", err)
		}
	}

	return finalErr
}

func (e *EventMonitor) createPortMapping(ctx context.Context, namespace, containerID string) (nat.PortMap, error) {
	container, err := e.containerdClient.ContainerService().Get(
		containerdNamespace.WithNamespace(ctx, namespace), containerID)
	if err != nil {
		return nil, err
	}

	log.Debugf("got the container [%s] from namespace [%s]", container.ID, namespace)

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

func updateListener(ctx context.Context, portMappings nat.PortMap, action func(context.Context, net.IP, int) error) {
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

// Port is representing nerdctl/ports entry in the
// evnet envelope's labels.
type Port struct {
	HostPort      int
	ContainerPort int
	Protocol      string
	HostIP        string
}
