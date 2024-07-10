//go:build unix

package client

import (
	"errors"

	"golang.org/x/sys/unix"
)

func handleConnectionRefused(err error) error {
	if errors.Is(err, unix.ECONNREFUSED) {
		return ErrConnectionRefused
	}
	return err
}
