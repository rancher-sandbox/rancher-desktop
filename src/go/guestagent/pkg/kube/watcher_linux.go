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

// Package kube watches Kubernetes for NodePort and LoadBalancer service types.
// It exposes the services as follows:
// - [namespaced network - admin install]: It uses API tracker to expose the ports
// on the host through host-switch.exe
// - [namespaced network - non-admin install]: It uses API tracker to expose the ports
// on the host through host-switch.exe; however, the exposed ports are only bound to
// 127.0.0.1 on the host machine.
package kube

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"golang.org/x/sys/unix"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

// watcherState is an enumeration to track the state of the watcher.
type watcherState int

const (
	// stateNoConfig is before the configuration has been loaded.
	stateNoConfig watcherState = iota
	// stateDisconnected is when the configuration has been loaded, but not connected.
	stateDisconnected
	stateWatching
)

// WatchForServices watches Kubernetes for NodePort and LoadBalancer services
// and create listeners on 0.0.0.0 matching them.
// Any connection errors are ignored and retried.
func WatchForServices(
	ctx context.Context,
	configPath string,
	k8sServiceListenerIP net.IP,
	portTracker tracker.Tracker,
) error {
	// These variables are shared across the different states
	var (
		state     = stateNoConfig
		err       error
		config    *restclient.Config
		clientset *kubernetes.Clientset
		eventCh   <-chan event
		errorCh   <-chan error
	)

	watchContext, watchCancel := context.WithCancel(ctx)

	// Always cancel if we failed.
	defer watchCancel()

	for {
		switch state {
		case stateNoConfig:
			config, err = getClientConfig(configPath)
			if err != nil {
				log.Debugw("kubernetes: failed to read kubeconfig", log.Fields{
					"config-path": configPath,
					"error":       err,
				})

				if errors.Is(err, fs.ErrNotExist) {
					// Wait for the file to exist
					time.Sleep(time.Second)

					continue
				}

				return err
			}

			log.Debugf("kubernetes: loaded kubeconfig %s", configPath)

			state = stateDisconnected
		case stateDisconnected:
			clientset, err = kubernetes.NewForConfig(config)
			if err != nil {
				// There should be no transient errors here
				log.Errorw("failed to load kubeconfig", log.Fields{
					"config-path": configPath,
					"error":       err,
				})

				return fmt.Errorf("failed to create Kubernetes client: %w", err)
			}

			eventCh, errorCh, err = watchServices(watchContext, clientset)
			if err != nil {
				switch {
				default:
					return err
				case isTimeout(err):
				case errors.Is(err, unix.ENETUNREACH):
				case errors.Is(err, unix.ECONNREFUSED):
				case isAPINotReady(err):
				}
				// sleep and continue for all the expected case
				time.Sleep(time.Second)

				continue
			}

			log.Debugf("watching kubernetes services")

			state = stateWatching
		case stateWatching:
			select {
			case <-ctx.Done():
				log.Debugw("kubernetes watcher: context closed", log.Fields{
					"error": ctx.Err(),
				})

				return ctx.Err()
			case err = <-errorCh:
				log.Debugw("kubernetes: got error, rolling back", log.Fields{
					"error": err,
				})
				watchCancel()

				state = stateNoConfig

				time.Sleep(time.Second)

				continue
			case event := <-eventCh:
				if event.deleted {
					if err := portTracker.Remove(string(event.UID)); err != nil {
						log.Errorf("failed to delete port mapping: %v from tracker UID: %v namespace: %s name: %s failed: %s",
							event.portMapping,
							event.UID,
							event.namespace,
							event.name,
							err)
					} else {
						log.Debugf("kubernetes service: port mapping deleted %s/%s:%v",
							event.namespace, event.name, event.portMapping)
					}
				} else {
					portMapping, err := createPortMapping(event.portMapping, k8sServiceListenerIP)
					if err != nil {
						log.Errorf("failed to create port mapping: %v from tracker UID: %v namespace: %s name: %s failed: %s",
							event.portMapping,
							event.UID,
							event.namespace,
							event.name,
							err)

						continue
					}
					if err := portTracker.Add(string(event.UID), portMapping); err != nil {
						log.Errorf("failed to add port mapping: %v from tracker UID: %v namespace: %s name: %s failed: %s",
							event.portMapping,
							event.UID,
							event.namespace,
							event.name,
							err)
					} else {
						log.Debugf("kubernetes service: port mapping added %s/%s:%v",
							event.namespace, event.name, event.portMapping)
					}
				}
			}
		}
	}
}

// getClientConfig returns a rest config.
func getClientConfig(configPath string) (*restclient.Config, error) {
	loadingRules := clientcmd.ClientConfigLoadingRules{
		ExplicitPath: configPath,
	}
	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(&loadingRules, nil)
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("could not load Kubernetes client config from %s: %w", configPath, err)
	}

	return config, nil
}

func isTimeout(err error) bool {
	type timeout interface {
		Timeout() bool
	}

	var timeoutError timeout

	if !errors.As(err, &timeoutError) {
		return timeoutError != nil && timeoutError.Timeout()
	}

	return false
}

// This is a k3s error that is received over
// the HTTP, Also, it is worth noting that this
// error is wrapped. This is why we are not testing
// against the real error object using errors.Is().
func isAPINotReady(err error) bool {
	return strings.Contains(err.Error(), "apiserver not ready")
}

func createPortMapping(ports map[int32]corev1.Protocol, k8sServiceListenerIP net.IP) (nat.PortMap, error) {
	portMap := make(nat.PortMap)

	for port, proto := range ports {
		protocol := strings.ToLower(string(proto))
		log.Debugf("create port mapping for port %d, protocol %s", port, protocol)
		portMapKey, err := nat.NewPort(protocol, strconv.Itoa(int(port)))
		if err != nil {
			return nil, err
		}

		portBinding := nat.PortBinding{
			HostIP:   k8sServiceListenerIP.String(),
			HostPort: strconv.Itoa(int(port)),
		}

		if pb, ok := portMap[portMapKey]; ok {
			portMap[portMapKey] = append(pb, portBinding)
		} else {
			portMap[portMapKey] = []nat.PortBinding{portBinding}
		}
	}

	return portMap, nil
}
