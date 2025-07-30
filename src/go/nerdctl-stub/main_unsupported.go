//go:build !(linux || windows)

package main

import "context"

// This file is a stub for unsupported platforms to make IDEs happy.

// unhandledArgHandler is a handler for unsupported arguments.
func unhandledArgHandler(arg string) (string, []cleanupFunc, error) {
	panic("Platform is unsupported")
}

// argHandlers is the table of argument handlers.
var argHandlers = argHandlersType{
	volumeArgHandler:       unhandledArgHandler,
	filePathArgHandler:     unhandledArgHandler,
	outputPathArgHandler:   unhandledArgHandler,
	mountArgHandler:        unhandledArgHandler,
	builderCacheArgHandler: unhandledArgHandler,
}

func spawn(ctx context.Context, opts spawnOptions) error {
	panic("Platform is unsupported")
}

// function prepareParseArgs should be called before argument parsing to set up
// the system for arg parsing.
func prepareParseArgs() error {
	panic("Platform is unsupported")
}

// function cleanupParseArgs should be called after the command finishes
// (regardless of whether it succeeded) to clean up any resources.
func cleanupParseArgs() error {
	panic("Platform is unsupported")
}
