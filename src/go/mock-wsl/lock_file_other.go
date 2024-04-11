//go:build !windows

package main

import (
	"fmt"
	"os"
)

func lockFile(_ *os.File) error {
	return fmt.Errorf("not implemented")
}
