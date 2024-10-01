package runner

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTaskRunner(t *testing.T) {
	t.Run("should run all functions in order they were added if context not cancelled and no errors", func(t *testing.T) {
		ctx := context.Background()
		taskRunner := NewTaskRunner(ctx)
		runOrder := make([]int, 0, 3)
		for i := 1; i < 4; i++ {
			taskRunner.Add(func() error {
				runOrder = append(runOrder, i)
				return nil
			})
		}
		assert.NoError(t, taskRunner.Wait())
		assert.Equal(t, []int{1, 2, 3}, runOrder)
	})

	t.Run("should stop execution after current function when context is cancelled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		taskRunner := NewTaskRunner(ctx)

		// Used to delay until func1 has started running
		readyForCancelChan := make(chan struct{})
		// Gets closed when we want func1 to return
		func1Chan := make(chan struct{})
		func1Ran := false
		func1 := func() error {
			func1Ran = true
			t.Log("func1 ran")
			close(readyForCancelChan)
			<-func1Chan
			return nil
		}

		func2Ran := false
		func2 := func() error {
			func2Ran = true
			t.Log("func2 ran")
			return nil
		}

		taskRunner.Add(func1)
		taskRunner.Add(func2)
		<-readyForCancelChan
		cancel()
		close(func1Chan)

		assert.ErrorIs(t, taskRunner.Wait(), ErrContextDone)
		assert.True(t, func1Ran)
		assert.False(t, func2Ran)
	})

	t.Run("should return error from first function that errors out and not run subsequent functions", func(t *testing.T) {
		ctx := context.Background()
		taskRunner := NewTaskRunner(ctx)

		expectedError := "func1 error"
		ranSlice := make([]bool, 2)
		for i := range ranSlice {
			taskRunner.Add(func() error {
				ranSlice[i] = true
				t.Logf("func%d ran", i+1)
				return fmt.Errorf("func%d error", i+1)
			})
		}
		if err := taskRunner.Wait(); err != nil {
			assert.Equal(t, expectedError, err.Error())
		}
		assert.True(t, ranSlice[0])
		assert.False(t, ranSlice[1])
	})
}
