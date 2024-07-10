package cmd

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTruncateToNewlineOrMaxRunes(t *testing.T) {
	testCases := []struct {
		Input     string
		MaxLength int
		Expected  string
	}{
		{
			Input:     "this string 🔥✨🎉 is 40 bytes\nlong",
			MaxLength: 14,
			Expected:  "this string 🔥…",
		},
		{
			Input:     "this string 🔥✨🎉 is 40 bytes\nlong",
			MaxLength: 15,
			Expected:  "this string 🔥✨…",
		},
		{
			Input:     "this string 🔥✨🎉 is 40 bytes\nlong",
			MaxLength: 22,
			Expected:  "this string 🔥✨🎉 is 40…",
		},
		{
			Input:     "this string 🔥✨🎉 is 40 bytes\nlong",
			MaxLength: 31,
			Expected:  "this string 🔥✨🎉 is 40 bytes…",
		},
		{
			Input:     "this string 🔥✨🎉 is 40 bytes\nlong",
			MaxLength: 28,
			Expected:  "this string 🔥✨🎉 is 40 bytes…",
		},
		{
			Input:     "",
			MaxLength: 15,
			Expected:  "",
		},
		{
			Input:     "\nthis is a test\n",
			MaxLength: 20,
			Expected:  "this is a test",
		},
	}

	for _, testCase := range testCases {
		description := fmt.Sprintf("truncate case %+v", testCase)
		t.Run(description, func(t *testing.T) {
			result := truncateAtNewlineOrMaxRunes(testCase.Input, testCase.MaxLength)
			assert.Equal(t, testCase.Expected, result)
		})
	}
}
