//go:build windows

/*
Copyright © 2021 SUSE LLC

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

package platform

import (
	"os"
	"testing"
	"time"

	"github.com/linuxkit/virtsock/pkg/hvsock"
	"github.com/stretchr/testify/assert"
)

func TestRacer(t *testing.T) {
	t.Run("simple-resolve", func(t *testing.T) {
		t.Parallel()
		r := newRacer(1)

		go func() {
			time.Sleep(time.Millisecond)
			r.resolve(hvsock.GUIDLoopback)
		}()

		v, err := r.wait()
		assert.NoError(t, err)
		assert.Equal(t, hvsock.GUIDLoopback, v)
	})

	t.Run("simple-reject", func(t *testing.T) {
		t.Parallel()
		r := newRacer(1)

		go func() {
			time.Sleep(time.Millisecond)
			r.reject(os.ErrInvalid)
		}()

		_, err := r.wait()
		assert.ErrorIs(t, err, os.ErrInvalid)
	})

	t.Run("any-resolve", func(t *testing.T) {
		t.Parallel()
		r := newRacer(2)

		go func() {
			time.Sleep(time.Millisecond)
			r.reject(os.ErrInvalid)
			r.resolve(hvsock.GUIDLoopback)
		}()

		v, err := r.wait()
		if assert.NoError(t, err) {
			assert.Equal(t, v, hvsock.GUIDLoopback)
		}
	})

	t.Run("first-resolve", func(t *testing.T) {
		t.Parallel()
		r := newRacer(2)

		go func() {
			time.Sleep(time.Millisecond)
			r.resolve(hvsock.GUIDLoopback)
			r.resolve(hvsock.GUIDParent)
		}()

		v, err := r.wait()
		if assert.NoError(t, err) {
			assert.Equal(t, v, hvsock.GUIDLoopback)
		}
	})
}
