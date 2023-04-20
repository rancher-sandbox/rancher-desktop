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
	"net/http"
	"strings"

	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/docker/go-connections/nat"
)

const (
	GatewayBaseURL = "http://192.168.127.1:80"
	HostSwitchIP   = "192.168.127.2"
	exposeAPI      = "/services/forwarder/expose"
	unexposeAPI    = "/services/forwarder/unexpose"
)

var ErrAPI = errors.New("error from API")

// APITracker keeps track of the port mappings and calls the
// corresponding API endpoints that is responsible for exposing
// and unexposing the ports on the host. This should only be used when
// the Rancher Desktop networking is enabled and the privileged service is disabled.
type APITracker struct {
	baseURL     string
	httpClient  http.Client
	portStorage *portStorage
	*ListenerTracker
}

// NewAPITracker creates a new instace of a API Tracker.
func NewAPITracker(baseURL string) *APITracker {
	return &APITracker{
		baseURL:         baseURL,
		httpClient:      *http.DefaultClient,
		portStorage:     newPortStorage(),
		ListenerTracker: NewListenerTracker(),
	}
}

// Add adds a container ID and port mapping to the tracker and calls the
// /services/forwarder/expose endpoint to forward the port mappings.
func (a *APITracker) Add(containerID string, portMap nat.PortMap) error {
	var errs []error

	successfullyForwarded := make(nat.PortMap)

	for portProto, portBindings := range portMap {
		var tmpPortBinding []nat.PortBinding

		for _, portBinding := range portBindings {
			err := a.expose(
				&types.ExposeRequest{
					Local:  ipPortBuilder(portBinding.HostIP, portBinding.HostPort),
					Remote: ipPortBuilder(HostSwitchIP, portBinding.HostPort),
				})
			if err != nil {
				errs = append(errs, fmt.Errorf("failed exposing %+v calling API: %w", portBinding, err))

				continue
			}

			tmpPortBinding = append(tmpPortBinding, portBinding)
		}

		successfullyForwarded[portProto] = tmpPortBinding
	}

	a.portStorage.add(containerID, successfullyForwarded)

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrAPI, errs)
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
	portMappings := a.portStorage.get(containerID)
	defer a.portStorage.remove(containerID)

	var errs []error

	for _, portBindings := range portMappings {
		for _, portBinding := range portBindings {
			err := a.unExpose(
				&types.UnexposeRequest{
					Local: ipPortBuilder(portBinding.HostIP, portBinding.HostPort),
				})
			if err != nil {
				errs = append(errs,
					fmt.Errorf("failed unexposing %+v calling API: %w", portBinding, err))

				continue
			}
		}
	}

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrAPI, errs)
	}

	return nil
}

// RemoveAll calls the /services/forwarder/unexpose
// and removes all the port bindings from the tracker.
func (a *APITracker) RemoveAll() error {
	var errs []error

	allPortMappings := a.portStorage.getAll()

	for _, portMapping := range allPortMappings {
		for _, portBindings := range portMapping {
			for _, portBinding := range portBindings {
				err := a.unExpose(
					&types.UnexposeRequest{
						Local: ipPortBuilder(portBinding.HostIP, portBinding.HostPort),
					})
				if err != nil {
					errs = append(errs,
						fmt.Errorf("failed unexposing %+v calling API: %w", portBinding, err))

					continue
				}
			}
		}
	}

	a.portStorage.removeAll()

	if len(errs) != 0 {
		return fmt.Errorf("%w: %+v", ErrAPI, errs)
	}

	return nil
}

func (a *APITracker) expose(exposeReq *types.ExposeRequest) error {
	bin, err := json.Marshal(exposeReq)
	if err != nil {
		return err
	}

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

	return verifyResposeBody(res)
}

func (a *APITracker) unExpose(unexposeReq *types.UnexposeRequest) error {
	bin, err := json.Marshal(unexposeReq)
	if err != nil {
		return err
	}

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

	return verifyResposeBody(res)
}

func (a *APITracker) urlBuilder(api string) string {
	return a.baseURL + api
}

func ipPortBuilder(ip, port string) string {
	return ip + ":" + port
}

func verifyResposeBody(res *http.Response) error {
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
