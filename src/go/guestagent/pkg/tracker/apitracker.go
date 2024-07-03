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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

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
	exposeAPI    = "/services/forwarder/expose"
	unexposeAPI  = "/services/forwarder/unexpose"
)

var (
	ErrAPI         = errors.New("error from API")
	ErrExposeAPI   = fmt.Errorf("error from %s API", exposeAPI)
	ErrUnexposeAPI = fmt.Errorf("error from %s API", unexposeAPI)
	ErrInvalidIPv4 = errors.New("not an IPv4 address")
	ErrWSLProxy    = errors.New("error from Rancher Desktop WSL Proxy")
)

// APITracker keeps track of the port mappings and calls the
// corresponding API endpoints that is responsible for exposing
// and unexposing the ports on the host. This should only be used when
// the Rancher Desktop networking is enabled and the privileged service is disabled.
type APITracker struct {
	forwarder   forwarder.Forwarder
	isAdmin     bool
	baseURL     string
	httpClient  http.Client
	portStorage *portStorage
	*ListenerTracker
}

// NewAPITracker creates a new instance of a API Tracker.
func NewAPITracker(forwarder forwarder.Forwarder, baseURL string, isAdmin bool) *APITracker {
	return &APITracker{
		forwarder:       forwarder,
		isAdmin:         isAdmin,
		baseURL:         baseURL,
		httpClient:      *http.DefaultClient,
		portStorage:     newPortStorage(),
		ListenerTracker: NewListenerTracker(),
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

			log.Debugf("calling %s API for the following port binding: %+v", exposeAPI, portBinding)

			err = a.expose(
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

	err := a.forwarder.Send(portMapping)
	if err != nil {
		return fmt.Errorf("sending port mappings to wsl proxy error: %w", err)
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrExposeAPI, errs)
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

			log.Debugf("calling %s API for the following port binding: %+v", unexposeAPI, portBinding)

			err = a.unexpose(
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
	err := a.forwarder.Send(portMapping)
	if err != nil {
		return fmt.Errorf("sending port mappings to wsl proxy error: %w", err)
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrUnexposeAPI, errs)
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

				log.Debugf("calling %s API for the following port binding: %+v", unexposeAPI, portBinding)

				err = a.unexpose(
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
		wslProxyError := a.forwarder.Send(portMapping)
		if wslProxyError != nil {
			wslProxyErrs = append(wslProxyErrs,
				fmt.Errorf("sending port mappings to wsl proxy error: %w", wslProxyError))
		}
	}

	a.portStorage.removeAll()

	if len(apiErrs) != 0 {
		return fmt.Errorf("%w: %+v", ErrUnexposeAPI, apiErrs)
	}

	if len(wslProxyErrs) != 0 {
		return fmt.Errorf("%w: %+v", ErrWSLProxy, wslProxyErrs)
	}

	return nil
}

func (a *APITracker) expose(exposeReq *types.ExposeRequest) error {
	bin, err := json.Marshal(exposeReq)
	if err != nil {
		return err
	}

	log.Debugf("sending a HTTP POST to %s API with expose request: %v", exposeAPI, exposeReq)
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		a.urlBuilder(exposeAPI),
		bytes.NewReader(bin))
	if err != nil {
		return err
	}

	res, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}

	return verifyResponseBody(res)
}

func (a *APITracker) unexpose(unexposeReq *types.UnexposeRequest) error {
	bin, err := json.Marshal(unexposeReq)
	if err != nil {
		return err
	}

	log.Debugf("sending a HTTP POST to %s API with expose request: %v", unexposeAPI, unexposeReq)
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		a.urlBuilder(unexposeAPI),
		bytes.NewReader(bin))
	if err != nil {
		return err
	}

	res, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}

	return verifyResponseBody(res)
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

func (a *APITracker) urlBuilder(api string) string {
	return a.baseURL + api
}

func ipPortBuilder(ip, port string) string {
	return ip + ":" + port
}

func verifyResponseBody(res *http.Response) error {
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		apiResponse, readErr := io.ReadAll(res.Body)
		if readErr != nil {
			return fmt.Errorf("error while reading response body: %w", readErr)
		}

		errMsg := strings.TrimSpace(string(apiResponse))

		return fmt.Errorf("%w: %s", ErrAPI, errMsg)
	}

	return nil
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
