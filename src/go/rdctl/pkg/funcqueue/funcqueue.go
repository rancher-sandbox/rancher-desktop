package funcqueue

import (
	"context"
	"errors"
)

var ErrContextDone error = errors.New("context done")

// FuncQueue accepts functions and asynchronously calls them in the
// order they were recieved. Before each function is called, FuncQueue
// checks whether its context is marked done; if so, it stops calling
// functions.
type FuncQueue struct {
	context  context.Context
	funcChan chan func() error
	errChan  chan error
}

func NewFuncQueue(ctx context.Context) *FuncQueue {
	funcChan := make(chan func() error, 10)
	errChan := make(chan error)
	go checkContextBetween(ctx, funcChan, errChan)
	return &FuncQueue{
		context:  ctx,
		funcChan: funcChan,
		errChan:  errChan,
	}
}

// Appends a function to the queue of functions to be called.
func (funcQueue *FuncQueue) Add(function func() error) {
	funcQueue.funcChan <- function
}

// Waits until the last function has completed, returning the first
// (if any) error returned by a passed function.
func (funcQueue *FuncQueue) Wait() error {
	close(funcQueue.funcChan)
	err, ok := <-funcQueue.errChan
	if ok {
		return err
	}
	return nil
}

// checkContextBetween is the main loop of the FuncQueue type.
func checkContextBetween(ctx context.Context, funcChan <-chan func() error, errChan chan<- error) {
	for function := range funcChan {
		select {
		case <-ctx.Done():
			errChan <- ErrContextDone
			goto close
		default:
			if err := function(); err != nil {
				errChan <- err
				goto close
			}
		}
	}
close:
	close(errChan)
}
