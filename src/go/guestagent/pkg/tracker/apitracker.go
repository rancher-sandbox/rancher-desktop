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
	"strings"

	"github.com/Masterminds/log-go"
	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/docker/go-connections/nat"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/forwarder"
	guestagentTypes "github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
)

const (
	// The gateway represents the hostname where the hostSwitch API is hosted.
	gateway        = "gateway.rancher-desktop.internal"
	GatewayBaseURL = "http://" + gateway + ":80"
)

var (
	ErrAPI         = errors.New("error from API")
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
	baseURL           string
	tapInterfaceIP    string
	portStorage       *portStorage
	apiForwarder      *forwarder.APIForwarder
}

// NewAPITracker creates a new instance of APITracker with the specified configuration.
//   - ctx: The context to manage the lifecycle and cancellation of operations. It allows the APITracker
//     to be aware of broader request timeouts or cancellation signals.
//   - wslProxyForwarder: An interface or struct responsible for forwarding API calls to the Rancher Desktop's WSL proxy.
//     It handles sending port mapping updates and removals from other WSL distros.
//   - baseURL: The base URL of the API server that the APITracker will communicate with to expose or unexpose
//     ports. This URL is used by the APIForwarder to construct API requests.
//   - tapIfaceIP: The IP address of the tap interface that the API calls will use for port forwarding. This address
//     is used to route traffic from the host to the container.
//   - isAdmin: Indicates whether the application is running with administrative privileges. This flag determines
//     whether the APITracker should use the localhost IP address (127.0.0.1) for operations if not running as an
//     administrator.
func NewAPITracker(ctx context.Context, wslProxyForwarder forwarder.Forwarder, baseURL, tapIfaceIP string, isAdmin bool) *APITracker {
	return &APITracker{
		context:           ctx,
		wslProxyForwarder: wslProxyForwarder,
		isAdmin:           isAdmin,
		baseURL:           baseURL,
		tapInterfaceIP:    tapIfaceIP,
		portStorage:       newPortStorage(),
		apiForwarder:      forwarder.NewAPIForwarder(baseURL),
	}
}

// Add a container ID and port mapping to the tracker and calls the
// /services/forwarder/expose endpoint to forward the port mappings.
func (a *APITracker) Add(containerID string, portMap nat.PortMap) error {
	var errs []error

	successfullyForwarded := make(nat.PortMap)

	for portProto, portBindings := range portMap {
		var tmpPortBinding []nat.PortBinding

		log.Debugf("called add with portProto: %+v, portBindings: %+v\n", portProto, portBindings)

		for _, portBinding := range portBindings {
			// The expose API only supports IPv4
			ipv4, err := isIPv4(portBinding.HostIP)
			if !ipv4 || err != nil {
				log.Errorf("did not receive IPv4 for HostIP: %s", portBinding.HostIP)
				continue
			}

			log.Debugf("exposing the following port binding: %+v", portBinding)

			err = a.apiForwarder.Expose(
				&types.ExposeRequest{
					Local:    ipPortBuilder(a.determineHostIP(portBinding.HostIP), portBinding.HostPort),
					Remote:   ipPortBuilder(a.tapInterfaceIP, portBinding.HostPort),
					Protocol: types.TransportProtocol(strings.ToLower(portProto.Proto())),
				})
			if err != nil {
				errs = append(errs, fmt.Errorf("exposing %+v failed: %w", portBinding, err))

				continue
			}

			tmpPortBinding = append(tmpPortBinding, portBinding)
		}

		if len(tmpPortBinding) != 0 {
			successfullyForwarded[portProto] = tmpPortBinding
		}
	}

	if len(successfullyForwarded) != 0 {
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
// /services/forwarder/unexpose endpoint to remove the forwarded port mappings.
func (a *APITracker) Remove(containerID string) error {
	portMap := a.portStorage.get(containerID)
	defer a.portStorage.remove(containerID)

	var errs []error

	for portProto, portBindings := range portMap {
		for _, portBinding := range portBindings {
			// The unexpose API only supports IPv4
			ipv4, err := isIPv4(portBinding.HostIP)
			if !ipv4 || err != nil {
				log.Errorf("did not receive IPv4 for HostIP: %s", portBinding.HostIP)
				continue
			}

			log.Debugf("unexposing the following port binding: %+v", portBinding)

			err = a.apiForwarder.Unexpose(
				&types.UnexposeRequest{
					Local:    ipPortBuilder(a.determineHostIP(portBinding.HostIP), portBinding.HostPort),
					Protocol: types.TransportProtocol(strings.ToLower(portProto.Proto())),
				})
			if err != nil {
				errs = append(errs,
					fmt.Errorf("unexposing %+v failed: %w", portBinding, err))

				continue
			}
		}
	}

	if len(portMap) != 0 {
		portMapping := guestagentTypes.PortMapping{
			Remove: true,
			Ports:  portMap,
		}
		log.Debugf("forwarding to wsl-proxy to remove port mapping: %+v", portMapping)
		err := a.wslProxyForwarder.Send(portMapping)
		if err != nil {
			return fmt.Errorf("sending port mappings to wsl proxy error: %w", err)
		}
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

				log.Debugf("unexposing the following port binding: %+v", portBinding)

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
