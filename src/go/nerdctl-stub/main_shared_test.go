package main

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuilderCacheProcessor(t *testing.T) {
	t.Run("ignores unknown arguments", func(t *testing.T) {
		input := "hello/world,bar=baz"
		result, cleanups, err := builderCacheProcessor(input,
			func(s string) (string, []cleanupFunc, error) {
				t.Error("should not have called inputMounter with", s)
				return "", nil, fmt.Errorf("test failed")
			},
			func(s string) (string, []cleanupFunc, error) {
				t.Error("should not have called outputMounter with", s)
				return "", nil, fmt.Errorf("test failed")
			})
		assert.Equal(t, input, result, "input should not have changed")
		assert.Empty(t, cleanups, "no cleanup functions should have been added")
		assert.NoError(t, err, "error unexpected")
	})
	t.Run("processes input mounts", func(t *testing.T) {
		input := "extra=stuff,src=moar stuff,trailer=other stuff"
		cleanupDone := false
		result, cleanups, err := builderCacheProcessor(input,
			func(s string) (string, []cleanupFunc, error) {
				assert.Equal(t, "moar stuff", s)
				return "modified stuff", []cleanupFunc{func() error {
					cleanupDone = true
					return nil
				}}, nil
			},
			func(s string) (string, []cleanupFunc, error) {
				t.Error("should not have called outputMounter with", s)
				return "", nil, fmt.Errorf("test failed")
			})
		assert.Equal(t, "extra=stuff,src=modified stuff,trailer=other stuff", result)
		assert.NotEmpty(t, cleanups, "expected cleanup functions")
		assert.NoError(t, err, "error running builderCacheProcessor")
		assert.False(t, cleanupDone, "cleanup function already ran")
		assert.NoError(t, runCleanups(cleanups))
		assert.True(t, cleanupDone, "cleanup function did not run")
	})
	t.Run("processes output mounts", func(t *testing.T) {
		input := "extra=stuff,dest=moar stuff,trailer=other stuff"
		cleanupDone := false
		result, cleanups, err := builderCacheProcessor(input,
			func(s string) (string, []cleanupFunc, error) {
				t.Error("should not have called inputMounter with", s)
				return "", nil, fmt.Errorf("test failed")
			},
			func(s string) (string, []cleanupFunc, error) {
				assert.Equal(t, "moar stuff", s)
				return "modified stuff", []cleanupFunc{func() error {
					cleanupDone = true
					return nil
				}}, nil
			})
		assert.Equal(t, "extra=stuff,dest=modified stuff,trailer=other stuff", result)
		assert.NotEmpty(t, cleanups, "expected cleanup functions")
		assert.NoError(t, err, "error running builderCacheProcessor")
		assert.False(t, cleanupDone, "cleanup function already ran")
		assert.NoError(t, runCleanups(cleanups))
		assert.True(t, cleanupDone, "cleanup function did not run")
	})
}
