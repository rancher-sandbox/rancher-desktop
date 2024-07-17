package client

import (
	"errors"

	"golang.org/x/sys/windows"
)

func handleConnectionRefused(err error) error {
	if errors.Is(err, windows.WSAECONNREFUSED) {
		return ErrConnectionRefused
	}
	return err
}
