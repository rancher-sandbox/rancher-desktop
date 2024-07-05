//go:build !linux

package main

import (
	"log"
)

func main() {
	log.Fatal("nerdctl-stub generate needs to be done on Linux")
}
