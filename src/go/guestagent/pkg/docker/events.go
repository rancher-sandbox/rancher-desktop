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

	"github.com/Masterminds/log-go"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
)

const (
	startEvent = "start"
	stopEvent  = "stop"
)

// EventMonitor monitors the Docker engine's Event API
// for container events.
type EventMonitor struct {
	dockerClient *client.Client
}

// NewEventMonitor creates and returns a new Event Monitor for
// Docker's event API. Caller is responsible to make sure that
// Docker engine is up and running.
func NewEventMonitor() (*EventMonitor, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}

	return &EventMonitor{
		dockerClient: cli,
	}, nil
}

// MonitorPorts scans Docker's event stream API
// for container start/stop events.
func (e *EventMonitor) MonitorPorts(ctx context.Context, portTracker *tracker.PortTracker) {
	msgCh, errCh := e.dockerClient.Events(ctx, types.EventsOptions{Filters: filters.NewArgs(
		filters.Arg("type", "container"),
		filters.Arg("event", startEvent),
		filters.Arg("event", stopEvent))})

	for {
		select {
		case <-ctx.Done():
			log.Errorf("context cancellation: %v", ctx.Err())

			return
		case event := <-msgCh:
			log.Debugf("received an event: %+v", event)
			container, err := e.dockerClient.ContainerInspect(ctx, event.ID)
			if err != nil {
				log.Errorf("inspecting container [%v] failed: %v", event.ID, err)

				continue
			}

			switch event.Action {
			case startEvent:
				if len(container.NetworkSettings.NetworkSettingsBase.Ports) != 0 {
					portTracker.Add(container.ID, container.NetworkSettings.NetworkSettingsBase.Ports)
				}
			case stopEvent:
				portTracker.Remove(container.ID)
			}
		case err := <-errCh:
			log.Errorf("receiving container event failed: %v", err)

			return
		}
	}
}

// Info returns information about the docker server
// it is used to verify that docker engine server is up.
func (e *EventMonitor) Info(ctx context.Context) error {
	_, err := e.dockerClient.Info(ctx)

	return err
}
