package main

import (
	"log"
	"regexp"
	"strings"
)

// This file contains handlers for specific commands.

// Run the given cleanup functions; this is meant for aborting a command handler
// early.
func runCleanups(cleanups []cleanupFunc) {
	for _, cleanup := range cleanups {
		cleanupErr := cleanup()
		if cleanupErr != nil {
			log.Printf("Error cleaning up: %s", cleanupErr)
		}
	}
}

// imageBuildHandler handles `nerdctl image build`
func imageBuildHandler(c *commandDefinition, args []string) (*parsedArgs, error) {
	// The first argument is the directory to build; the rest are ignored.
	if len(args) < 1 {
		// This will return an error
		return &parsedArgs{args: args}, nil
	}
	input := args[0]
	if input == "-" {
		return &parsedArgs{args: args}, nil
	}
	if match, _ := regexp.MatchString(`^[^:/]*://`, input); match {
		// input is a URL
		return &parsedArgs{args: args}, nil
	}
	newPath, cleanups, err := filePathArgHandler(args[0])
	if err != nil {
		runCleanups(cleanups)
		return nil, err
	}
	return &parsedArgs{args: append([]string{newPath}, args[1:]...), cleanup: cleanups}, nil
}

// containerCopyHandler handles `nerdctl container cp`
func containerCopyHandler(c *commandDefinition, args []string) (*parsedArgs, error) {
	var resultArgs []string
	var cleanups []cleanupFunc

	// Positional arguments `nerdctl container cp` are all paths, whether inside
	// the container or outside.

	for _, arg := range args {
		if arg == "-" {
			// flag for stdin/stdout; don't need to deal with that.
			resultArgs = append(resultArgs, arg)
			continue
		}
		// There are three possible cases for the arg:
		// - There are no `:`s in the string -- a host-side relative path.
		// - Any single character before `:` -- assume a drive letter.
		// - Any other sequence before `:` -- container specification.
		// Note that the latter case means a container with a single-letter name
		// will not correctly; but that's probably acceptable for now.
		parts := strings.SplitN(arg, ":", 2)
		if len(parts) != 2 || len(parts[0]) == 1 {
			// This is a host-side file path (first two cases above).
			newPath, newCleanups, err := filePathArgHandler(arg)
			if err != nil {
				cleanups = append(cleanups, newCleanups...)
				runCleanups(cleanups)
				return nil, err
			}
			resultArgs = append(resultArgs, newPath)
		} else {
			// This is a container-side path (third case above).
			// Just pass it in to nerdctl directly.
			resultArgs = append(resultArgs, arg)
		}
	}

	return &parsedArgs{args: resultArgs, cleanup: cleanups}, nil
}
