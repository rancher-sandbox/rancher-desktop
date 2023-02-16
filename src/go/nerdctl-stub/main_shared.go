//go:build linux || windows
// +build linux windows

// This file contains routines shared between Windows and Linux.

package main

import (
	"fmt"
	"strings"
)

// mountArgProcessor implements the details for handling the argument for
// `nerdctl run --mount=...`
func mountArgProcessor(arg string, mounter func(string) (string, error)) (string, []cleanupFunc, error) {
	var chunks [][]string
	isBind := false
	for _, chunk := range strings.Split(arg, ",") {
		parts := strings.SplitN(chunk, "=", 2)
		if len(parts) != 2 {
			// Got something with no value, e.g. --mount=...,readonly,...
			chunks = append(chunks, []string{chunk})
			continue
		}
		if parts[0] == "type" && parts[1] == "bind" {
			isBind = true
		}
		chunks = append(chunks, parts)
	}
	if !isBind {
		// Not a bind mount; don't attempt to fix anything
		return arg, nil, nil
	}
	for _, chunk := range chunks {
		if len(chunk) != 2 {
			continue
		}
		if chunk[0] != "source" && chunk[0] != "src" {
			continue
		}
		mountDir, err := mounter(chunk[1])
		if err != nil {
			return "", nil, err
		}
		chunk[1] = mountDir
	}
	result := ""
	for _, chunk := range chunks {
		result = fmt.Sprintf("%s,%s", result, strings.Join(chunk, "="))
	}
	return result[1:], nil, nil // Skip the initial "," we added
}
