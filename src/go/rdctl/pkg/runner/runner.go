package runner

import (
	"context"
	"errors"
)

var ErrContextDone error = errors.New("context marked done")

// TaskRunner accepts functions and asynchronously calls them in the
// order they were received. Before each function is called, TaskRunner
// checks whether its context is marked done; if so, it stops calling
// functions.
type TaskRunner struct {
	context  context.Context
	funcChan chan func() error
	errChan  chan error
}

func NewTaskRunner(ctx context.Context) *TaskRunner {
	funcChan := make(chan func() error, 10)
	errChan := make(chan error)
	go checkContextBetween(ctx, funcChan, errChan)
	return &TaskRunner{
		context:  ctx,
		funcChan: funcChan,
		errChan:  errChan,
	}
}

// Appends a function to the queue of functions to be called.
func (tr *TaskRunner) Add(function func() error) {
	tr.funcChan <- function
}

// Waits until the last function has completed, returning the first
// (if any) error returned by a passed function.
func (tr *TaskRunner) Wait() error {
	close(tr.funcChan)
	err, ok := <-tr.errChan
	if ok {
		return err
	}
	return nil
}

// checkContextBetween is the main loop of the TaskRunner type.
func checkContextBetween(ctx context.Context, funcChan <-chan func() error, errChan chan<- error) {
	defer close(errChan)
	for function := range funcChan {
		select {
		case <-ctx.Done():
			errChan <- ErrContextDone
			return
		default:
			if err := function(); err != nil {
				errChan <- err
				return
			}
		}
	}
}
