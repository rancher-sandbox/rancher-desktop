package main

import (
	"log"
	"regexp"
)

// This file contains handlers for specific commands.

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
		for _, cleanup := range cleanups {
			cleanupErr := cleanup()
			if cleanupErr != nil {
				log.Printf("Error cleaning up: %s", cleanupErr)
			}
		}
		return nil, err
	}
	return &parsedArgs{args: append([]string{newPath}, args[1:]...), cleanup: cleanups}, nil
}
