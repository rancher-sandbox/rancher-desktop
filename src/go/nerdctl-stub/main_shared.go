// This file contains shared routines for managing arguments.

package main

import (
	"fmt"
	"strings"

	"github.com/hashicorp/go-multierror"
)

func runCleanups(cleanups []cleanupFunc) error {
	var errors *multierror.Error

	for _, cleanup := range cleanups {
		if err := cleanup(); err != nil {
			errors = multierror.Append(errors, err)
		}
	}

	return errors.ErrorOrNil()
}

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

// builderCacheProcessor implements the details for handling the argument for
// `nerdctl builder build --cache-from=...` and
// `nerdctl builder build --cache-to=...`
func builderCacheProcessor(arg string, inputMounter, outputMounter func(string) (string, []cleanupFunc, error)) (string, []cleanupFunc, error) {
	var cleanups []cleanupFunc

	// The arg is comma-separated args, with `type=` and `src=`, `dest=`
	// If no type is given, nerdctl assume `type=registry`, which we can ignore.
	// ref: https://github.com/containerd/nerdctl/blob/v1.2.0/pkg/cmd/builder/build.go#L333-L345
	// Otherwise, for `src=` it's an input, and `dest=` is an output.
	var parts []string
	for _, part := range strings.Split(arg, ",") {
		if strings.HasPrefix(part, "src=") {
			srcPath := part[len("src="):]
			fixedPath, newCleanups, err := inputMounter(srcPath)
			if err != nil {
				errors := multierror.Append(err, runCleanups(newCleanups))
				if errors.Len() > 1 {
					return "", nil, errors
				}
				return "", nil, errors.Unwrap()
			}
			parts = append(parts, "src="+fixedPath)
			cleanups = append(cleanups, newCleanups...)
		} else if strings.HasPrefix(part, "dest=") {
			destPath := part[len("dest="):]
			fixedPath, newCleanups, err := outputMounter(destPath)
			if err != nil {
				errors := multierror.Append(err, runCleanups(newCleanups))
				if errors.Len() > 1 {
					return "", nil, errors
				}
				return "", nil, errors.Unwrap()
			}
			parts = append(parts, "dest="+fixedPath)
			cleanups = append(cleanups, newCleanups...)
		} else {
			parts = append(parts, part)
		}
	}

	resultArg := strings.Join(parts, ",")
	return resultArg, cleanups, nil
}
