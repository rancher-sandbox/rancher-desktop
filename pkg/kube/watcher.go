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

// Package kube watches Kubernetes for NodePort services and forces a listener
// on 127.0.0.1, so that it can be picked up by the automatic port forwarding
// mechanisms found in WSLv2 and Lima.
package kube

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"strconv"
	"time"

	"github.com/Masterminds/log-go"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
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

// WatchServcies watches Kubernetes for NodePort and LoadBalancer services
// and create listeners on 0.0.0.0 matching them.
// Any connection errors are ignored and retried.
func WatchForServices(
	ctx context.Context,
	configPath string,
	k8sServiceListenerIP net.IP,
	enablePrivilegedService bool,
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

	// Always cancel if we failed; however, we may clobber watchCancel, so we
	// need a wrapper function to capture the variable reference.
	defer func() {
		watchCancel()
	}()

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
				if isTimeout(err) {
					// If it's a time out, the server may not be running yet
					time.Sleep(time.Second)

					continue
				}

				return err
			}

			log.Debugf("watching kubernetes services")

			state = stateWatching
		case stateWatching:
			select {
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
					if enablePrivilegedService {
						if err := portTracker.Remove(string(event.UID)); err != nil {
							log.Errorw("failed to delete a port from tracker", log.Fields{
								"error":     err,
								"UID":       event.UID,
								"ports":     event.portMapping,
								"namespace": event.namespace,
								"name":      event.name,
							})
						} else {
							log.Debugf("kubernetes service: port mapping deleted %s/%s:%v",
								event.namespace, event.name, event.portMapping)
						}

						continue
					}

					for port := range event.portMapping {
						if err := portTracker.RemoveListener(ctx, k8sServiceListenerIP, int(port)); err != nil {
							log.Errorw("failed to close listener", log.Fields{
								"error":     err,
								"ports":     event.portMapping,
								"namespace": event.namespace,
								"name":      event.name,
							})
						}
					}

					log.Debugf("kubernetes service: deleted listener %s/%s:%v",
						event.namespace, event.name, event.portMapping)
				} else {
					if enablePrivilegedService {
						portMapping, err := createPortMapping(event.portMapping, k8sServiceListenerIP)
						if err != nil {
							log.Errorw("failed to create port mapping", log.Fields{
								"error":     err,
								"ports":     event.portMapping,
								"namespace": event.namespace,
								"name":      event.name,
							})

							continue
						}
						if err := portTracker.Add(string(event.UID), portMapping); err != nil {
							log.Errorw("failed to add port mapping", log.Fields{
								"error":     err,
								"ports":     event.portMapping,
								"namespace": event.namespace,
								"name":      event.name,
							})
						} else {
							log.Debugf("kubernetes service: port mapping added %s/%s:%v",
								event.namespace, event.name, event.portMapping)
						}

						continue
					}
					for port := range event.portMapping {
						if err := portTracker.AddListener(ctx, k8sServiceListenerIP, int(port)); err != nil {
							log.Errorw("failed to create listener", log.Fields{
								"error":     err,
								"ports":     event.portMapping,
								"namespace": event.namespace,
								"name":      event.name,
							})
						}
					}

					log.Debugf("kubernetes service: started listener %s/%s:%v",
						event.namespace, event.name, event.portMapping)
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
	var timeoutError interface {
		Timeout() bool
	}

	if !errors.As(err, &timeoutError) {
		return timeoutError.Timeout()
	}

	return false
}

func createPortMapping(ports map[int32]corev1.Protocol, k8sServiceListenerIP net.IP) (nat.PortMap, error) {
	portMap := make(nat.PortMap)

	for port, proto := range ports {
		log.Debugf("create port mapping for port %d, protocol %s", port, proto)
		portMapKey, err := nat.NewPort(string(proto), strconv.Itoa(int(port)))
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
