package main

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

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

	handlers := argHandlersType{
		filePathArgHandler: func(s string) (string, []cleanupFunc, error) {
			return fmt.Sprintf("<%s>", s), nil, nil
		},
	}

	for _, testCase := range testCases {
		func(testCase testCaseType) {
			t.Run(strings.Join(testCase.input, "/"), func(t *testing.T) {
				t.Parallel()
				result, err := containerCopyHandler(nil, testCase.input, handlers)
				if testCase.err != "" {
					assert.EqualError(t, err, testCase.err)
				} else {
					assert.NoError(t, err, "Unexpected error running copy handler")
					assert.Equal(t, testCase.expected, result.args)
					assert.Empty(t, result.cleanup)
				}
			})
		}(testCase)
	}
}
