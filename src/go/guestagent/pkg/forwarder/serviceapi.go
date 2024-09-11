/*
Copyright © 2024 SUSE LLC

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

package forwarder

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Masterminds/log-go"
	"github.com/containers/gvisor-tap-vsock/pkg/types"
)

const (
	exposeAPI   = "/services/forwarder/expose"
	unexposeAPI = "/services/forwarder/unexpose"
)

var (
	ErrAPI         = errors.New("error from API")
	ErrExposeAPI   = fmt.Errorf("error from %s API", exposeAPI)
	ErrUnexposeAPI = fmt.Errorf("error from %s API", unexposeAPI)
)

// APIForwarder forwards the PortMappings to /services/forwarder/expose
// or /services/forwarder/unexpose that is host in the host-switch.
type APIForwarder struct {
	baseURL    string
	httpClient *http.Client
}

// NewAPIForwarder returns a new instance of APIForwarder.
func NewAPIForwarder(baseURL string) *APIForwarder {
	return &APIForwarder{
		baseURL:    baseURL,
		httpClient: http.DefaultClient,
	}
}

// Expose calls /services/forwarder/expose with a given portMappings.
func (a *APIForwarder) Expose(exposeReq *types.ExposeRequest) error {
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

// Unexpose calls /services/forwarder/unexpose with a given portMappings.
func (a *APIForwarder) Unexpose(unexposeReq *types.UnexposeRequest) error {
	bin, err := json.Marshal(unexposeReq)
	if err != nil {
		return err
	}

	log.Debugf("sending a HTTP POST to %s API with unexpose request: %v", unexposeAPI, unexposeReq)
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

func (a *APIForwarder) urlBuilder(api string) string {
	return a.baseURL + api
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
