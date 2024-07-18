/*
Copyright © 2023 SUSE LLC
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

package tracker

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"

	"github.com/Masterminds/log-go"
	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	guestagentTypes "github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

const (
	// The Gateway IP address that is statically reserved
	// by DHCP and will not change. It is used to initialize
	// the NewAPITracker.
	GatewayBaseURL = "http://192.168.127.1:80"
	// Tap device (eth0) IP which is also allocated to the host-switch
	// it is statically reserved by DHCP.
	hostSwitchIP = "192.168.127.2"
)

var (
	ErrInvalidIPv4 = errors.New("not an IPv4 address")
	ErrWSLProxy    = errors.New("error from Rancher Desktop WSL Proxy")
)

// APITracker keeps track of the port mappings and calls the
// corresponding API endpoints that is responsible for exposing
// and unexposing the ports on the host. This should only be used when
// the Rancher Desktop networking is enabled and the privileged service is disabled.
type APITracker struct {
	context           context.Context
	wslProxyForwarder forwarder.Forwarder
	isAdmin           bool
	enableListeners   bool
	baseURL           string
	portStorage       *portStorage
	apiForwarder      *forwarder.APIForwarder
	*ListenerTracker
}

// NewAPITracker creates a new instance of a API Tracker.
func NewAPITracker(ctx context.Context, wslProxyForwarder forwarder.Forwarder, baseURL string, isAdmin, enableListeners bool) *APITracker {
	return &APITracker{
		context:           ctx,
		wslProxyForwarder: wslProxyForwarder,
		isAdmin:           isAdmin,
		enableListeners:   enableListeners,
		baseURL:           baseURL,
		portStorage:       newPortStorage(),
		apiForwarder:      forwarder.NewAPIForwarder(baseURL),
		ListenerTracker:   NewListenerTracker(),
	}
}

// Add a container ID and port mapping to the tracker and calls the
// /services/forwarder/expose endpoint to forward the port mappings.
func (a *APITracker) Add(containerID string, portMap nat.PortMap) error {
	var errs []error

	successfullyForwarded := make(nat.PortMap)

	for portProto, portBindings := range portMap {
		var tmpPortBinding []nat.PortBinding

		for _, portBinding := range portBindings {
			// The expose API only supports IPv4
			ipv4, err := isIPv4(portBinding.HostIP)
			if !ipv4 || err != nil {
				continue
			}

			if a.enableListeners {
				hostPort, err := strconv.Atoi(portBinding.HostPort)
				if err != nil {
					log.Errorf("error converting hostPort: %s", err)
					continue
				}
				if err := a.AddListener(a.context, net.IP(portBinding.HostIP), hostPort); err != nil {
					log.Errorf("creating listener for %s and %s failed: %s", portBinding.HostIP, portBinding.HostPort, err)
					continue
				}
			}

			log.Debugf("calling /services/forwarder/expose API for the following port binding: %+v", portBinding)

			err = a.apiForwarder.Expose(
				&types.ExposeRequest{
					Local:  ipPortBuilder(a.determineHostIP(portBinding.HostIP), portBinding.HostPort),
					Remote: ipPortBuilder(hostSwitchIP, portBinding.HostPort),
				})
			if err != nil {
				errs = append(errs, fmt.Errorf("exposing %+v failed: %w", portBinding, err))

				continue
			}

			tmpPortBinding = append(tmpPortBinding, portBinding)
		}

		successfullyForwarded[portProto] = tmpPortBinding
	}

	a.portStorage.add(containerID, successfullyForwarded)
	portMapping := guestagentTypes.PortMapping{
		Remove: false,
		Ports:  successfullyForwarded,
	}
	log.Debugf("forwarding to wsl-proxy to add port mapping: %+v", portMapping)

	err := a.wslProxyForwarder.Send(portMapping)
	if err != nil {
		return fmt.Errorf("sending port mappings to wsl proxy error: %w", err)
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", forwarder.ErrExposeAPI, errs)
	}

	return nil
}

// Get looks up the port mapping by containerID and returns the result.
func (a *APITracker) Get(containerID string) nat.PortMap {
	return a.portStorage.get(containerID)
}

// Remove a single entry from the port storage and calls the
// /services/forwarder/unexpose endpoint to remove the forwarded the port mappings.
func (a *APITracker) Remove(containerID string) error {
	portMap := a.portStorage.get(containerID)
	defer a.portStorage.remove(containerID)

	var errs []error

	for _, portBindings := range portMap {
		for _, portBinding := range portBindings {
			// The unexpose API only supports IPv4
			ipv4, err := isIPv4(portBinding.HostIP)
			if !ipv4 || err != nil {
				continue
			}

			if a.enableListeners {
				hostPort, err := strconv.Atoi(portBinding.HostPort)
				if err != nil {
					log.Errorf("error converting hostPort: %s", err)
					continue
				}
				if err := a.RemoveListener(a.context, net.IP(portBinding.HostIP), hostPort); err != nil {
					log.Errorf("removing listener for %s and %s failed: %s", portBinding.HostIP, portBinding.HostPort, err)
					continue
				}
			}

			log.Debugf("calling /services/forwarder/expose API for the following port binding: %+v", portBinding)

			err = a.apiForwarder.Unexpose(
				&types.UnexposeRequest{
					Local: ipPortBuilder(a.determineHostIP(portBinding.HostIP), portBinding.HostPort),
				})
			if err != nil {
				errs = append(errs,
					fmt.Errorf("unexposing %+v failed: %w", portBinding, err))

				continue
			}
		}
	}

	portMapping := guestagentTypes.PortMapping{
		Remove: true,
		Ports:  portMap,
	}
	log.Debugf("forwarding to wsl-proxy to remove port mapping: %+v", portMapping)
	err := a.wslProxyForwarder.Send(portMapping)
	if err != nil {
		return fmt.Errorf("sending port mappings to wsl proxy error: %w", err)
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", forwarder.ErrUnexposeAPI, errs)
	}

	return nil
}

// RemoveAll calls the /services/forwarder/unexpose
// and removes all the port bindings from the tracker.
func (a *APITracker) RemoveAll() error {
	var apiErrs, wslProxyErrs []error

	for _, portMapping := range a.portStorage.getAll() {
		for _, portBindings := range portMapping {
			for _, portBinding := range portBindings {
				// The unexpose API only supports IPv4
				ipv4, err := isIPv4(portBinding.HostIP)
				if !ipv4 || err != nil {
					continue
				}

				log.Debugf("calling /services/forwarder/unexpose API for the following port binding: %+v", portBinding)

				err = a.apiForwarder.Unexpose(
					&types.UnexposeRequest{
						Local: ipPortBuilder(a.determineHostIP(portBinding.HostIP), portBinding.HostPort),
					})
				if err != nil {
					apiErrs = append(apiErrs,
						fmt.Errorf("RemoveAll unexposing %+v failed: %w", portBinding, err))

					continue
				}
			}
		}

		portMapping := guestagentTypes.PortMapping{
			Remove: true,
			Ports:  portMapping,
		}

		log.Debugf("forwarding to wsl-proxy to remove port mapping: %+v", portMapping)
		wslProxyError := a.wslProxyForwarder.Send(portMapping)
		if wslProxyError != nil {
			wslProxyErrs = append(wslProxyErrs,
				fmt.Errorf("sending port mappings to wsl proxy error: %w", wslProxyError))
		}
	}

	a.portStorage.removeAll()

	if len(apiErrs) != 0 {
		return fmt.Errorf("%w: %+v", forwarder.ErrUnexposeAPI, apiErrs)
	}

	if len(wslProxyErrs) != 0 {
		return fmt.Errorf("%w: %+v", ErrWSLProxy, wslProxyErrs)
	}

	return nil
}

func (a *APITracker) determineHostIP(hostIP string) string {
	// If Rancher Desktop is installed as non-admin, we use the
	// localhost IP address since binding to a port on 127.0.0.1
	// does not require administrative privileges on Windows.
	if !a.isAdmin {
		return "127.0.0.1"
	}

	return hostIP
}

func ipPortBuilder(ip, port string) string {
	return ip + ":" + port
}

func isIPv4(addr string) (bool, error) {
	ip := net.ParseIP(addr)
	if ip == nil {
		return false, fmt.Errorf("%w: %s", ErrInvalidIPv4, addr)
	}

	if ip.To4() != nil {
		return true, nil
	}

	return false, nil
}
