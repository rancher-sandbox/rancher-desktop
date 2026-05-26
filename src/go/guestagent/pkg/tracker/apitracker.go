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
	// ErrPortAlreadyExposed signals that Add was a no-op because another
	// component had already exposed every port in the request. Callers
	// that scan for ports another actor may own (kube watcher, iptables
	// scanner, /proc/net scanner) should treat this as successful
	// delegation rather than a failure to retry.
	ErrPortAlreadyExposed = errors.New("port already exposed by another component")
)

// portAlreadyExposedSubstring is the substring host-switch's
// /services/forwarder/expose response carries when the port is already
// bound. The string is the host-switch wire contract; matching it here
// lets callers rely on errors.Is(err, ErrPortAlreadyExposed) instead of
// inspecting message text.
const portAlreadyExposedSubstring = "proxy already running"

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
//
// If the expose API returns portAlreadyExposedSubstring for every port
// in the request and no other failures occurred, Add returns
// ErrPortAlreadyExposed so callers can treat the call as successful
// delegation rather than a failure to retry.
func (a *APITracker) Add(containerID string, portMap nat.PortMap) error {
	var errs []error
	var alreadyExposed int

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
				if strings.Contains(err.Error(), portAlreadyExposedSubstring) {
					alreadyExposed++
					continue
				}
				errs = append(errs, fmt.Errorf("exposing %+v failed: %w", portBinding, err))

				continue
			}

			tmpPortBinding = append(tmpPortBinding, portBinding)
		}

		if len(tmpPortBinding) != 0 {
			successfullyForwarded[portProto] = tmpPortBinding
		}
	}

	// Report the host-switch expose failures and the wsl-proxy failure
	// under distinct sentinels, joined so neither is swallowed -- matching
	// APITracker.Remove.
	var retErr error
	if len(errs) != 0 {
		retErr = fmt.Errorf("%w: %+v", forwarder.ErrExposeAPI, errs)
	}

	if len(successfullyForwarded) != 0 {
		a.portStorage.add(containerID, successfullyForwarded)
		portMapping := guestagentTypes.PortMapping{
			Remove: false,
			Ports:  successfullyForwarded,
		}
		log.Debugf("forwarding to wsl-proxy to add port mapping: %+v", portMapping)
		if err := a.wslProxyForwarder.Send(portMapping); err != nil {
			retErr = errors.Join(retErr, fmt.Errorf("%w: %w", ErrWSLProxy, err))
		}
	}

	// If every Expose call that ran reported the port as already
	// exposed -- no successful forwards, no other failures, no
	// wsl-proxy error -- surface the sentinel so callers downgrade
	// the result from an error to a delegation no-op.
	if retErr == nil && alreadyExposed > 0 && len(successfullyForwarded) == 0 {
		retErr = ErrPortAlreadyExposed
	}

	return retErr
}

// Get looks up the port mapping by containerID and returns the result.
func (a *APITracker) Get(containerID string) nat.PortMap {
	return a.portStorage.get(containerID)
}

// Remove unexposes the bindings stored under containerID and updates
// portStorage. Bindings whose Unexpose call succeeds drop from storage;
// bindings whose Unexpose call fails remain in storage so a later
// Remove(containerID) can retry them. wsl-proxy is notified of the
// successful unexposes only -- a later retry that succeeds will send a
// fresh notification for those bindings.
func (a *APITracker) Remove(containerID string) error {
	portMap := a.portStorage.get(containerID)
	if len(portMap) == 0 {
		return nil
	}

	var unexposeErrs []error
	unexposed := make(nat.PortMap)
	remaining := make(nat.PortMap)

	for portProto, portBindings := range portMap {
		var unexposedBindings []nat.PortBinding
		var remainingBindings []nat.PortBinding
		for _, portBinding := range portBindings {
			// The unexpose API only supports IPv4. Non-IPv4 entries
			// were never exposed via the API, so we drop them from
			// storage rather than retain them -- a retry would skip
			// them again with the same isIPv4 result.
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
				unexposeErrs = append(unexposeErrs,
					fmt.Errorf("unexposing %+v failed: %w", portBinding, err))
				remainingBindings = append(remainingBindings, portBinding)
				continue
			}
			unexposedBindings = append(unexposedBindings, portBinding)
		}
		if len(unexposedBindings) > 0 {
			unexposed[portProto] = unexposedBindings
		}
		if len(remainingBindings) > 0 {
			remaining[portProto] = remainingBindings
		}
	}

	// Update portStorage: retain only the bindings whose Unexpose
	// failed; drop the entry entirely if everything succeeded.
	if len(remaining) > 0 {
		a.portStorage.add(containerID, remaining)
	} else {
		a.portStorage.remove(containerID)
	}

	// Report the host-switch unexpose failures and the wsl-proxy failure
	// under distinct sentinels, joined so neither is swallowed. The
	// /proc/net scanner's retireDisappeared keys off forwarder.ErrUnexposeAPI
	// to decide whether the host-switch proxy may still be bound, so a
	// wsl-proxy-only failure -- where every Unexpose landed and the proxy is
	// gone -- must stay distinguishable from an unexpose failure.
	var retErr error
	if len(unexposeErrs) != 0 {
		retErr = fmt.Errorf("%w: %+v", forwarder.ErrUnexposeAPI, unexposeErrs)
	}

	if len(unexposed) > 0 {
		portMapping := guestagentTypes.PortMapping{
			Remove: true,
			Ports:  unexposed,
		}
		log.Debugf("forwarding to wsl-proxy to remove port mapping: %+v", portMapping)
		if err := a.wslProxyForwarder.Send(portMapping); err != nil {
			retErr = errors.Join(retErr, fmt.Errorf("%w: %w", ErrWSLProxy, err))
		}
	}

	return retErr
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

	// Report the host-switch unexpose failures and the wsl-proxy
	// failures under distinct sentinels, joined so neither is swallowed
	// -- matching APITracker.Remove.
	var retErr error
	if len(apiErrs) != 0 {
		retErr = fmt.Errorf("%w: %+v", forwarder.ErrUnexposeAPI, apiErrs)
	}

	if len(wslProxyErrs) != 0 {
		retErr = errors.Join(retErr, fmt.Errorf("%w: %+v", ErrWSLProxy, wslProxyErrs))
	}

	return retErr
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
