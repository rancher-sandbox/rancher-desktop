package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
)

const (
	Version    = "1.1.0"
	ApiVersion = "v1"
)

var ErrConnectionRefused = errors.New("connection refused")

type BackendState struct {
	VMState string `json:"vmState"`
	Locked  bool   `json:"locked"`
}

// APIError - type for representing errors from API calls.
type APIError struct {
	Message          *string `json:"message,omitempty"`
	DocumentationURL *string `json:"documentation_url,omitempty"`
}

type RDClient interface {
	DoRequest(method string, command string) (*http.Response, error)
	DoRequestWithPayload(method string, command string, payload io.Reader) (*http.Response, error)
	GetBackendState() (BackendState, error)
	UpdateBackendState(state BackendState) error
}

func validateBackendState(state BackendState) error {
	validStates := []string{"STOPPED", "STARTING", "STARTED", "STOPPING", "ERROR", "DISABLED"}
	for _, validState := range validStates {
		if state.VMState == validState {
			return nil
		}
	}
	return fmt.Errorf("invalid backend state %q", state.VMState)
}

type RDClientImpl struct {
	connectionInfo *config.ConnectionInfo
}

func NewRDClient(connectionInfo *config.ConnectionInfo) *RDClientImpl {
	return &RDClientImpl{
		connectionInfo: connectionInfo,
	}
}

func (client *RDClientImpl) makeURL(host string, port int, command string) string {
	if strings.HasPrefix(command, "/") {
		return fmt.Sprintf("http://%s:%d%s", host, port, command)
	}
	return fmt.Sprintf("http://%s:%d/%s", host, port, command)
}

func (client *RDClientImpl) DoRequest(method string, command string) (*http.Response, error) {
	req, err := client.getRequestObject(method, command)
	if err != nil {
		return nil, err
	}
	return http.DefaultClient.Do(req)
}

func (client *RDClientImpl) DoRequestWithPayload(method string, command string, payload io.Reader) (*http.Response, error) {
	url := client.makeURL(client.connectionInfo.Host, client.connectionInfo.Port, command)
	req, err := http.NewRequest(method, url, payload)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(client.connectionInfo.User, client.connectionInfo.Password)
	req.Header.Add("Content-Type", "application/json")
	req.Close = true
	return http.DefaultClient.Do(req)
}

func (client *RDClientImpl) getRequestObject(method string, command string) (*http.Request, error) {
	url := client.makeURL(client.connectionInfo.Host, client.connectionInfo.Port, command)
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(client.connectionInfo.User, client.connectionInfo.Password)
	req.Header.Add("Content-Type", "text/plain")
	req.Close = true
	return req, nil
}

func (client *RDClientImpl) GetBackendState() (BackendState, error) {
	body, err := ProcessRequestForUtility(client.DoRequest("GET", VersionCommand("", "backend_state")))
	if err != nil {
		return BackendState{}, err
	}
	state := BackendState{}
	if err := json.Unmarshal(body, &state); err != nil {
		return BackendState{}, fmt.Errorf("failed to unmarshal backend state: %w", err)
	}
	if err := validateBackendState(state); err != nil {
		return BackendState{}, err
	}
	return state, nil
}

func (client *RDClientImpl) UpdateBackendState(state BackendState) error {
	buf := &bytes.Buffer{}
	encoder := json.NewEncoder(buf)
	if err := encoder.Encode(state); err != nil {
		return fmt.Errorf("failed to marshal backend state: %w", err)
	}
	_, err := ProcessRequestForUtility(client.DoRequestWithPayload("PUT", VersionCommand("", "backend_state"), buf))
	if err != nil {
		return err
	}
	return nil
}
