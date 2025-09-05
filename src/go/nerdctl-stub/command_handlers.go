package main

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/hashicorp/go-multierror"
)

// This file contains handlers for specific commands.

// fileOrUrlOrStdin handles arguments of kind `file|URL|-`.  It returns a
// mounted path (or the arg as-is), any cleanups, and errors.
func fileOrUrlOrStdin(input string, argHandlers argHandlersType) (string, []cleanupFunc, error) {
	if input == "-" {
		return input, nil, nil
	}
	if match, _ := regexp.MatchString(`^[^:/]*://`, input); match {
		// input is a URL
		return input, nil, nil
	}
	newPath, cleanups, err := argHandlers.filePathArgHandler(input)
	if err != nil {
		if cleanupErr := runCleanups(cleanups); cleanupErr != nil {
			err = multierror.Append(err, cleanupErr)
		}
		return input, nil, err
	}
	return newPath, cleanups, nil
}

// builderBuildHandler handles `nerdctl image build`
func builderBuildHandler(c *commandDefinition, args []string, argHandlers argHandlersType) (*parsedArgs, error) {
	// nerdctl image build [flags] PATH
	// The first argument is the directory to build; the rest are ignored.
	if len(args) < 1 {
		// This will return an error
		return &parsedArgs{args: args}, nil
	}
	newPath, cleanups, err := fileOrUrlOrStdin(args[0], argHandlers)
	if err != nil {
		return nil, err
	}
	return &parsedArgs{args: append([]string{newPath}, args[1:]...), cleanup: cleanups}, nil
}

// hostPathResult is the return value of a hostPathDeterminerFunc that is used
// in containerCopyHandler for determining which argument is the host path that
// must be munged.
type hostPathResult int

const (
	hostPathUnknown = hostPathResult(iota)
	hostPathCurrent = hostPathResult(iota)
	hostPathOther   = hostPathResult(iota)
	hostPathNeither = hostPathResult(iota)
)

// containerCopyHandler handles `nerdctl container cp`
func containerCopyHandler(c *commandDefinition, args []string, argHandlers argHandlersType) (*parsedArgs, error) {
	var resultArgs []string
	var cleanups []cleanupFunc
	var paths []string

	// Positional arguments `nerdctl container cp` are all paths, whether inside
	// the container or outside.

	for _, arg := range args {
		if arg == "-" || !strings.HasPrefix(arg, "-") {
			// If the arg is "-" (stdin/stdout) or doesn't start with -, it's a path.
			paths = append(paths, arg)
		} else {
			resultArgs = append(resultArgs, arg)
		}
	}

	if len(paths) != 2 {
		// We should have exactly one source and one destination... just fail
		err := fmt.Errorf("accepts 2 args, received %d", len(paths))
		if cleanupErr := runCleanups(cleanups); cleanupErr != nil {
			err = multierror.Append(err, cleanupErr)
		}
		return nil, err
	}

	hostPathDeterminerFuncs := []func(i int, p string) hostPathResult{
		func(i int, p string) hostPathResult {
			if p == "-" {
				// If one argument is "-", the other must be a container path, so
				// neither needs to be modified.
				return hostPathNeither
			}
			return hostPathUnknown
		},
		func(i int, p string) hostPathResult {
			colon := strings.Index(p, ":")
			if colon < 1 {
				// If there's no colon in the path specification at all, or if the
				// string starts with a colon (which is invalid), then this must not be
				// a container path (and therefore the other one is).
				return hostPathCurrent
			}
			return hostPathUnknown
		},
		func(i int, p string) hostPathResult {
			colon := strings.Index(p, ":")
			if colon > 1 {
				// There's multiple characters before the first colon; this is a container
				// path specification (foo:/path/in/container), so the other must be a
				// host path specification.
				return hostPathOther
			}
			return hostPathUnknown
		},
		func(i int, p string) hostPathResult {
			if strings.Index(p, ":") != 1 {
				// Shouldn't get here -- one of the two previous functions should have
				// found something already.
				panic(fmt.Sprintf("Expected path %q to start with a character followed by a colon!", p))
			}
			if i != 0 {
				panic("Should not reach this on second path")
			}
			// Fall back: the first element should be treated as the container path.
			return hostPathOther
		},
	}

functionLoop:
	for _, f := range hostPathDeterminerFuncs {
		for i, p := range paths {
			result := f(i, p)
			hostPathIndex := i
			switch result {
			case hostPathNeither:
				//nolint:gocritic // We break the loop once we are done appending
				resultArgs = append(resultArgs, paths...)
				break functionLoop
			case hostPathUnknown:
				continue
			case hostPathOther:
				hostPathIndex = 1 - i
			}

			// If we reach here, we found the host path to munge.
			// Modify the path in-place.
			newPath, newCleanups, err := argHandlers.filePathArgHandler(paths[hostPathIndex])
			cleanups = append(cleanups, newCleanups...)
			if err != nil {
				if cleanupErr := runCleanups(cleanups); cleanupErr != nil {
					err = multierror.Append(err, cleanupErr)
				}
				return nil, err
			}
			paths[hostPathIndex] = newPath
			//nolint:gocritic // We break the loop once we are done appending
			resultArgs = append(resultArgs, paths...)
			break functionLoop
		}
	}

	return &parsedArgs{args: resultArgs, cleanup: cleanups}, nil
}

// imageImportHandler handles `nerdctl image import`
func imageImportHandler(c *commandDefinition, args []string, argHandlers argHandlersType) (*parsedArgs, error) {
	// nerdctl image import [OPTIONS] file|URL|- [REPOSITORY[:TAG]] [flags]
	if len(args) < 1 {
		// This will return an error
		return &parsedArgs{args: args}, nil
	}
	newPath, cleanups, err := fileOrUrlOrStdin(args[0], argHandlers)
	if err != nil {
		return nil, err
	}
	return &parsedArgs{args: append([]string{newPath}, args[1:]...), cleanup: cleanups}, nil
}
