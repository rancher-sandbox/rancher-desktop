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
	"time"

	"github.com/Masterminds/log-go"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tcplistener"
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

// WatchForNodePortServices watches Kubernetes for NodePort services and create
// listeners on 127.0.0.1 matching them.
//
// Any connection errors are ignored and retried.
func WatchForNodePortServices(ctx context.Context, tracker *tcplistener.ListenerTracker, configPath string) error {
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
	localhost := net.IPv4(127, 0, 0, 1) //nolint:gomnd

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
				watchContext, watchCancel = context.WithCancel(ctx)
				state = stateNoConfig

				time.Sleep(time.Second)

				continue
			case event := <-eventCh:
				if event.deleted {
					if err := tracker.Remove(ctx, localhost, int(event.port)); err != nil {
						log.Errorw("failed to close listener", log.Fields{
							"error":     err,
							"port":      event.port,
							"namespace": event.namespace,
							"name":      event.name,
						})

						continue
					}

					log.Debugf("kuberentes service: deleted listener %s/%s:%d",
						event.namespace, event.name, event.port)
				} else {
					if err := tracker.Add(ctx, localhost, int(event.port)); err != nil {
						log.Errorw("failed to create listener", log.Fields{
							"error":     err,
							"port":      event.port,
							"namespace": event.namespace,
							"name":      event.name,
						})

						continue
					}

					log.Debugf("kubernetes service: started listener %s/%s:%d",
						event.namespace, event.name, event.port)
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
