// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package util

import (
	"context"
	"net"
)

type dialResult struct {
	conn net.Conn
	err  error
}

// DialCancelable runs dial and returns its result, or ctx.Err() if ctx ends
// first.  It is for dial functions that cannot be interrupted.  When ctx ends
// first, the dial keeps running, and DialCancelable closes any connection that
// dial returns later.
func DialCancelable(ctx context.Context, dial func() (net.Conn, error)) (net.Conn, error) {
	ch := make(chan dialResult, 1)
	go func() {
		conn, err := dial()
		ch <- dialResult{conn: conn, err: err}
	}()

	select {
	case result := <-ch:
		return result.conn, result.err
	case <-ctx.Done():
		go func() {
			if result := <-ch; result.conn != nil {
				_ = result.conn.Close()
			}
		}()
		return nil, ctx.Err()
	}
}
