//go:build windows
// +build windows

package dockerproxy

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
