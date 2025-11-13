/*
Copyright © 2025 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Package command implements helpers for command-line handling.
package command

import (
	"context"
	"fmt"
	"runtime"
)

type commandNameContextKey struct{}

// WithCommandName returns a new context that keeps track of the command being
// invoked.
func WithCommandName(ctx context.Context, commandName string) context.Context {
	return context.WithValue(ctx, commandNameContextKey{}, commandName)
}

// FatalError is an error that should stop execution immediately, without using
// the normal cobra error handling.
type FatalError interface {
	error
	// ExitCode returns the process exit code that should be set.
	ExitCode() int
}

// simpleFatalError implements FatalError
type simpleFatalError struct {
	message  string
	exitCode int
}

func (e *simpleFatalError) Error() string {
	return e.message
}

func (e *simpleFatalError) ExitCode() int {
	return e.exitCode
}

// NewFatalError returns an error implementing FatalError
func NewFatalError(message string, exitCode int) error {
	return &simpleFatalError{
		message:  message,
		exitCode: exitCode,
	}
}

const restartDirective = "Either run 'rdctl start' or start the Rancher Desktop application first"

// NewVMStateError returns an error stating that the Rancher Desktop VM (or WSL
// distribution) is not in the correct state.  If actualState is the empty
// string, then it signifies that the VM does not exist.
func NewVMStateError(ctx context.Context, desiredState, actualState string) error {
	commandName := "rdctl"
	if value, ok := ctx.Value(commandNameContextKey{}).(string); ok {
		commandName = value
	}

	status := fmt.Sprintf("needs to be running in order to execute '%s', but it currently is not.", commandName)
	if actualState != "" {
		status = fmt.Sprintf("needs to be in state %q in order to execute '%s', but it is current in state %q.", desiredState, commandName, actualState)
	}
	vm := "VM"
	if runtime.GOOS == "windows" {
		vm = "WSL distribution"
	}
	return NewFatalError(
		fmt.Sprintf("The Rancher Desktop %s %s\n%s", vm, status, restartDirective),
		1)
}
