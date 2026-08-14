/*
Copyright © 2026 SUSE LLC

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

// Package startwait blocks until the Rancher Desktop backend has finished
// starting, so that `rdctl start --wait` returns only once the container
// engine is usable.
package startwait

import (
	"context"
	"errors"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
)

// ErrBackendFailed is returned when the backend reports the ERROR state.
var ErrBackendFailed = errors.New("the Rancher Desktop backend failed to start; check the application logs")

// vmState values that end the wait. STARTED and DISABLED are both terminal
// successes: setState(STARTED/DISABLED) runs only after the container engine
// reports ready, so the docker socket is usable by the time either appears.
// DISABLED differs only in that Kubernetes is turned off.
const (
	stateStarted  = "STARTED"
	stateDisabled = "DISABLED"
	stateError    = "ERROR"
)

// GetStateFunc reads the current backend state. It exists so tests can drive
// the poll loop without a running application.
type GetStateFunc func(context.Context) (client.BackendState, error)

// LiveState reads the backend state over the command-server API. During a cold
// start the connection file has not been written yet, or names a server that
// is not listening; both surface as ErrConnectionRefused so the caller keeps
// polling until the new instance takes over.
func LiveState(ctx context.Context) (client.BackendState, error) {
	connInfo, err := config.GetConnectionInfo(true)
	if err != nil || connInfo == nil {
		return client.BackendState{}, client.ErrConnectionRefused
	}
	return client.NewRDClient(connInfo).GetBackendState(ctx)
}

// Wait polls getState until the backend is ready, fails, or ctx is done. tick
// paces the polling; each receive triggers the next poll. It returns nil once
// the backend is up, ErrBackendFailed on a reported failure, or ctx.Err() on
// timeout or cancellation. Connection errors before the server is up are
// expected and do not end the wait.
func Wait(ctx context.Context, tick <-chan time.Time, getState GetStateFunc) error {
	for {
		state, err := getState(ctx)
		switch {
		case err == nil:
			switch state.VMState {
			case stateStarted, stateDisabled:
				return nil
			case stateError:
				return ErrBackendFailed
			}
		case errors.Is(err, client.ErrConnectionRefused):
			// The server is not up yet; keep waiting.
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return err
		default:
			logrus.WithError(err).Trace("ignoring transient error while waiting for start")
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick:
		}
	}
}
