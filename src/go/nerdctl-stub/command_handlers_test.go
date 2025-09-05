package main

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuilderBuildHandler(t *testing.T) {
	t.Run("munges the image directory", func(t *testing.T) {
		handlers := argHandlersType{
			filePathArgHandler: func(s string) (string, []cleanupFunc, error) {
				return "<<path>>", nil, nil
			},
		}
		parsed, err := builderBuildHandler(nil, []string{"path"}, handlers)
		assert.NoError(t, err)
		assert.EqualValues(t, []string{"<<path>>"}, parsed.args)
		assert.Nil(t, parsed.cleanup)
	})
	t.Run("handles errors from munging", func(t *testing.T) {
		handlerError := fmt.Errorf("some handler error")
		cleanupError := fmt.Errorf("some cleanup error")
		handlers := argHandlersType{
			filePathArgHandler: func(s string) (string, []cleanupFunc, error) {
				return "", []cleanupFunc{func() error { return cleanupError }}, handlerError
			},
		}
		_, err := builderBuildHandler(nil, []string{"path"}, handlers)
		assert.Error(t, err)
		assert.ErrorContains(t, err, handlerError.Error())
		assert.ErrorContains(t, err, cleanupError.Error())
	})
}

func TestContainerCopyHandler(t *testing.T) {
	t.Parallel()
	type testCaseType struct {
		input    []string
		expected []string
		err      string
	}

	testCases := []testCaseType{
		{
			input:    []string{"-", "c:file"},
			expected: []string{"-", "c:file"},
		},
		{
			input:    []string{"c:file", "-"},
			expected: []string{"c:file", "-"},
		},
		{
			input:    []string{"input", "c:file"},
			expected: []string{"<input>", "c:file"},
		},
		{
			input:    []string{"c:file", "input"},
			expected: []string{"c:file", "<input>"},
		},
		{
			input:    []string{"container:path", "c:file"},
			expected: []string{"container:path", "<c:file>"},
		},
		{
			input:    []string{"c:file", "container:path"},
			expected: []string{"<c:file>", "container:path"},
		},
		{
			// Check fallback: if ambiguous, assume copying out of a container.
			input:    []string{"c:file", "d:file"},
			expected: []string{"c:file", "<d:file>"},
		},
		{
			input: []string{"missing argument"},
			err:   "accepts 2 args, received 1",
		},
		{
			input: []string{"missing positional argument", "-flag"},
			err:   "accepts 2 args, received 1",
		},
		{
			input:    []string{"-flag1", "c:file", "-flag2", "input", "-flag3"},
			expected: []string{"-flag1", "-flag2", "-flag3", "c:file", "<input>"},
		},
	}

	for _, testCase := range testCases {
		func(testCase testCaseType) {
			t.Run(strings.Join(testCase.input, "/"), func(t *testing.T) {
				t.Parallel()
				ranHandler := false
				ranCleanups := false
				handlers := argHandlersType{
					filePathArgHandler: func(s string) (string, []cleanupFunc, error) {
						ranHandler = true
						return fmt.Sprintf("<%s>", s), []cleanupFunc{func() error {
							ranCleanups = true
							return nil
						}}, nil
					},
				}

				result, err := containerCopyHandler(nil, testCase.input, handlers)
				if testCase.err != "" {
					assert.EqualError(t, err, testCase.err)
					if ranHandler {
						assert.True(t, ranCleanups)
					}
				} else {
					assert.NoError(t, err, "Unexpected error running copy handler")
					assert.Equal(t, testCase.expected, result.args)
					if ranHandler {
						assert.NotEmpty(t, result.cleanup)
						assert.False(t, ranCleanups)
						assert.NoError(t, runCleanups(result.cleanup))
						assert.True(t, ranCleanups)
					} else {
						assert.Empty(t, result.cleanup)
					}
				}
			})
		}(testCase)
	}

	t.Run("cleanup errors", func(t *testing.T) {
		handlerError := fmt.Errorf("some handler error")
		cleanupError := fmt.Errorf("some cleanup error")
		handlers := argHandlersType{
			filePathArgHandler: func(s string) (string, []cleanupFunc, error) {
				return "", []cleanupFunc{func() error { return cleanupError }}, handlerError
			},
		}
		_, err := containerCopyHandler(nil, []string{"host", "container:/path"}, handlers)
		assert.ErrorContains(t, err, handlerError.Error())
		assert.ErrorContains(t, err, cleanupError.Error())
	})
}

func TestImageImportHandler(t *testing.T) {
	cleanupError := fmt.Errorf("cleanup error")
	testCases := []struct {
		description   string
		input         []string
		expected      []string
		handler       func(s string) (string, []cleanupFunc, error)
		assertCleanup func(*testing.T, []cleanupFunc)
	}{
		{
			description: "ignore missing arguments",
			input:       []string{},
			expected:    []string{},
		},
		{
			description: "accepts stdin",
			input:       []string{"-"},
			expected:    []string{"-"},
		},
		{
			description: "accepts URLs",
			input:       []string{"https://registry.example.com/hello"},
			expected:    []string{"https://registry.example.com/hello"},
		},
		{
			description: "accepts paths",
			input:       []string{"hello"},
			expected:    []string{"<<hello>>"},
			handler: func(s string) (string, []cleanupFunc, error) {
				return "<<hello>>", []cleanupFunc{func() error { return cleanupError }}, nil
			},
			assertCleanup: func(t *testing.T, cf []cleanupFunc) {
				if assert.Len(t, cf, 1) {
					assert.ErrorIs(t, cf[0](), cleanupError)
				}
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.description, func(t *testing.T) {
			handlers := argHandlersType{
				filePathArgHandler: func(s string) (string, []cleanupFunc, error) {
					panic("should not be called")
				},
			}
			if testCase.handler != nil {
				handlers.filePathArgHandler = testCase.handler
			}
			parsed, err := imageImportHandler(nil, testCase.input, handlers)
			assert.NoError(t, err)
			assert.EqualValues(t, testCase.expected, parsed.args)
			if testCase.assertCleanup != nil {
				testCase.assertCleanup(t, parsed.cleanup)
			} else {
				assert.Zero(t, parsed.cleanup)
			}
		})
	}
}
