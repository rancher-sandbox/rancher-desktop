package main

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

var expectedError = fmt.Errorf("expected error")

func generateCleanupFunc(output *bool, withError bool) cleanupFunc {
	return func() error {
		if output != nil {
			*output = true
		}
		if withError {
			return expectedError
		}
		return nil
	}
}

func generateOptionHandler(output *bool, argError, cleanupError bool) argHandler {
	cleanup := generateCleanupFunc(output, cleanupError)
	return func(arg string) (string, []cleanupFunc, error) {
		if argError {
			return "", []cleanupFunc{cleanup}, expectedError
		}
		return arg, []cleanupFunc{cleanup}, nil
	}
}

func TestParseOptions(t *testing.T) {
	t.Parallel()
	t.Run("unsupported option", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{}
		_, _, _, err := c.parseOption("-hello", "world")
		assert.EqualError(t, err, `command "" does not support option -hello`)
	})
	t.Run("option with no value", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--hello": nil}}
		args, consumed, cleanup, err := c.parseOption("--hello", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"--hello"}, args)
			assert.False(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("option with value", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--hello": ignoredArgHandler}}
		args, consumed, cleanup, err := c.parseOption("--hello", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"--hello", "world"}, args)
			assert.True(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("option with embedded value", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--hello": ignoredArgHandler}}
		args, consumed, cleanup, err := c.parseOption("--hello=moo", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"--hello", "moo"}, args)
			assert.False(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("option with short name", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--hello": nil}}
		args, consumed, cleanup, err := c.parseOption("-hello", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"-hello"}, args)
			assert.False(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("option with bunched up single-letter options", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--ab": ignoredArgHandler, "-a": nil, "-b": nil}}
		args, consumed, cleanup, err := c.parseOption("-ab", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"-ab"}, args)
			assert.False(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("option with bunched up single-letter options, with argument", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--ab": nil, "-a": nil, "-b": ignoredArgHandler}}
		args, consumed, cleanup, err := c.parseOption("-ab", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"-ab", "world"}, args)
			assert.True(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("short option, not all characters are single-letter options", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--abc": nil, "-a": nil, "-c": ignoredArgHandler}}
		args, consumed, cleanup, err := c.parseOption("-abc", "world")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"-abc"}, args)
			assert.False(t, consumed)
			assert.Nil(t, cleanup)
		}
	})
	t.Run("passes along any cleanups on failure", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{
			options: map[string]argHandler{
				"--hello": generateOptionHandler(nil, true, true),
			},
		}
		_, _, cleanups, err := c.parseOption("--hello", "world")
		assert.Error(t, err)
		if assert.Len(t, cleanups, 1) {
			result := cleanups[0]()
			assert.Same(t, expectedError, result)
		}
	})
	t.Run("looks for options in parent commands", func(t *testing.T) {
		t.Parallel()
		localCommands := make(map[string]commandDefinition)
		localCommands[""] = commandDefinition{
			commands:    &localCommands,
			commandPath: "",
			options:     map[string]argHandler{"--hello": nil},
		}
		localCommands["subcommand"] = commandDefinition{
			commands:    &localCommands,
			commandPath: "subcommand",
			options:     map[string]argHandler{"--world": nil},
		}
		localCommands["subcommand more"] = commandDefinition{
			commands:    &localCommands,
			commandPath: "subcommand more",
			options:     map[string]argHandler{"--foo": nil},
		}
		command := localCommands["subcommand more"]
		args, _, _, err := command.parseOption("--hello", "")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"--hello"}, args)
		}

		args, _, _, err = command.parseOption("--world", "")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"--world"}, args)
		}

		args, _, _, err = command.parseOption("--foo", "")
		if assert.NoError(t, err) {
			assert.Equal(t, []string{"--foo"}, args)
		}
	})
}

func TestParse(t *testing.T) {
	t.Parallel()
	t.Run("options", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{options: map[string]argHandler{"--option": nil}}
		result, err := c.parse([]string{"--option"})
		if assert.NoError(t, err) {
			expected := &parsedArgs{args: []string{"--option"}}
			assert.Equal(t, expected, result)
		}
	})
	t.Run("options with parse error", func(t *testing.T) {
		t.Parallel()
		cleanupRun := false
		c := commandDefinition{
			options: map[string]argHandler{
				"-o": generateOptionHandler(&cleanupRun, true, false),
			},
		}
		_, err := c.parse([]string{"-o=xxx"})
		assert.Error(t, err)
		assert.True(t, cleanupRun)
	})
	t.Run("positional argument handler", func(t *testing.T) {
		t.Parallel()
		run := false
		c := commandDefinition{
			handler: func(c *commandDefinition, args []string) (*parsedArgs, error) {
				run = true
				assert.Equal(t, []string{"positional", "arguments"}, args)
				return &parsedArgs{}, nil
			},
		}
		_, err := c.parse([]string{"positional", "arguments"})
		assert.NoError(t, err)
		assert.True(t, run)
	})
	t.Run("positional args without handler", func(t *testing.T) {
		t.Parallel()
		c := commandDefinition{}
		result, err := c.parse([]string{"hello", "world"})
		assert.NoError(t, err)
		if assert.NotNil(t, result) {
			assert.Equal(t, []string{"hello", "world"}, result.args)
		}
	})
	t.Run("subcommand handler", func(t *testing.T) {
		t.Parallel()
		run := false
		localCommands := make(map[string]commandDefinition)
		localCommands[""] = commandDefinition{
			commands: &localCommands,
		}
		localCommands["subcommand"] = commandDefinition{
			commands: &localCommands,
			handler: func(c *commandDefinition, args []string) (*parsedArgs, error) {
				run = true
				assert.Equal(t, []string{"a", "b"}, args)
				return &parsedArgs{}, nil
			},
		}
		_, err := localCommands[""].parse([]string{"subcommand", "a", "b"})
		assert.NoError(t, err)
		assert.True(t, run)
	})
}
