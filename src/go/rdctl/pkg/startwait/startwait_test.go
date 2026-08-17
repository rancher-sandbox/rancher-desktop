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

package startwait

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
)

type poll struct {
	state string
	err   error
}

// stubStates returns a GetStateFunc that yields the given polls in order,
// repeating the last one once exhausted.
func stubStates(polls ...poll) GetStateFunc {
	i := 0
	return func(context.Context) (client.BackendState, error) {
		p := polls[i]
		if i < len(polls)-1 {
			i++
		}
		return client.BackendState{VMState: p.state}, p.err
	}
}

// ticker returns a channel that fires until the test ends, so Wait polls
// without a real delay between iterations.
func ticker(t *testing.T) <-chan time.Time {
	t.Helper()
	done := make(chan struct{})
	t.Cleanup(func() { close(done) })
	tick := make(chan time.Time)
	go func() {
		for {
			select {
			case tick <- time.Now():
			case <-done:
				return
			}
		}
	}()
	return tick
}

func TestWaitReturnsWhenStarted(t *testing.T) {
	getState := stubStates(
		poll{err: client.ErrConnectionRefused},
		poll{state: "STARTING"},
		poll{state: "STARTED"},
	)
	require.NoError(t, Wait(context.Background(), ticker(t), getState))
}

func TestWaitReturnsWhenDisabled(t *testing.T) {
	getState := stubStates(poll{state: "DISABLED"})
	require.NoError(t, Wait(context.Background(), ticker(t), getState))
}

func TestWaitFailsOnErrorState(t *testing.T) {
	getState := stubStates(poll{state: "ERROR"})
	assert.ErrorIs(t, Wait(context.Background(), ticker(t), getState), ErrBackendFailed)
}

func TestWaitStopsOnTimeout(t *testing.T) {
	// The backend never leaves STARTING, so the wait ends only when ctx does.
	getState := stubStates(poll{state: "STARTING"})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	assert.ErrorIs(t, Wait(ctx, ticker(t), getState), context.DeadlineExceeded)
}

func TestWaitIgnoresTransientErrors(t *testing.T) {
	getState := stubStates(
		poll{err: errors.New("temporary read failure")},
		poll{state: "STARTED"},
	)
	require.NoError(t, Wait(context.Background(), ticker(t), getState))
}
