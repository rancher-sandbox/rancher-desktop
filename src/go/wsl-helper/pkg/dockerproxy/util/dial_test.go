// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package util

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
)

// closeRecorder is a net.Conn that records whether Close was called.
type closeRecorder struct {
	net.Conn
	closed atomic.Bool
}

func (c *closeRecorder) Close() error {
	c.closed.Store(true)
	return nil
}

func TestDialCancelable(t *testing.T) {
	t.Run("slow dial succeeds", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			want := &closeRecorder{}
			conn, err := DialCancelable(t.Context(), func() (net.Conn, error) {
				time.Sleep(2 * time.Second)
				return want, nil
			})
			assert.NoError(t, err, "DialCancelable must not add a timeout of its own")
			assert.Same(t, want, conn)
			assert.False(t, want.closed.Load(), "a returned connection must not be closed")
		})
	})

	t.Run("cancel closes late connection", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			unblock := make(chan struct{})
			late := &closeRecorder{}
			done := make(chan error, 1)
			go func() {
				_, err := DialCancelable(ctx, func() (net.Conn, error) {
					<-unblock
					return late, nil
				})
				done <- err
			}()
			synctest.Wait()
			cancel()
			synctest.Wait()
			select {
			case err := <-done:
				assert.ErrorIs(t, err, context.Canceled)
			default:
				t.Fatal("DialCancelable did not return when its context was cancelled")
			}
			close(unblock)
			synctest.Wait()
			assert.True(t, late.closed.Load(), "a connection that arrives after cancellation must be closed")
		})
	})

	t.Run("dial error", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			dialErr := errors.New("dial failed")
			conn, err := DialCancelable(t.Context(), func() (net.Conn, error) {
				return nil, dialErr
			})
			assert.ErrorIs(t, err, dialErr)
			assert.Nil(t, conn)
		})
	})
}
