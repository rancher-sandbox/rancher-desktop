package main

import (
	"fmt"
	"log"
	"os"
	"slices"
	"strings"
)

type cleanupFunc func() error

// parsedArgs describes the result of calling parseArgs.
type parsedArgs struct {
	// Arguments for nerdctl with paths replaced.
	args []string
	// cleanup functions to call
	cleanup []cleanupFunc
}

// argHandler is the type of a function that handles some argument.
type argHandler func(string) (string, []cleanupFunc, error)

// argHandlersType defines the functions passed in command handlers.
type argHandlersType struct {
	volumeArgHandler       argHandler
	filePathArgHandler     argHandler
	outputPathArgHandler   argHandler
	mountArgHandler        argHandler
	builderCacheArgHandler argHandler
	buildContextArgHandler argHandler
}

// commandHandlerType is the type of commandDefinition.handler, which is used
// to handle positional arguments (and special subcommands).
// The passed-in arguments excludes any flags given after positional arguments.
type commandHandlerType func(*commandDefinition, []string, argHandlersType) (*parsedArgs, error)

type commandDefinition struct {
	// commands points to the global command map; if this is null, then the global
	// variable named "commands" is used instead.
	commands *map[string]commandDefinition
	// commandPath is the arguments needed to get to this command.
	commandPath string
	// subcommands that can be spawned from this command.
	subcommands map[string]struct{}
	// options for this (sub) command.  If the handler is null, the option does
	// not take arguments.
	options map[string]argHandler
	// if set, this command can include foreign flags that should not be parsed.
	// This should be set for things like `nerdctl run` where flags can be passed
	// to the command to be run.
	hasForeignFlags bool
	// handler for any positional arguments and subcommands.  This should not
	// include the name of the subcommand itself.  If this is not given, all
	// subcommands are searched for, and positional arguments are ignored.
	handler commandHandlerType
}

// parseOption takes an argument (that is known to start with `-` or `--`) plus
// the next argument (which may be needed if a value is required), and returns
// whether the value argument was consumed, plus any cleanup functions.
func (c *commandDefinition) parseOption(arg, next string) ([]string, bool, []cleanupFunc, error) {
	if !strings.HasPrefix(arg, "-") {
		panic(fmt.Sprintf("commandDefinition.parseOption called with invalid arg %q", arg))
	}

	// Figure out what the option name is
	option := arg
	value := next
	consumed := true
	sep := strings.Index(option, "=")
	if sep >= 0 {
		value = option[sep+1:]
		option = option[:sep]
		consumed = false
	}
	handler, ok := c.options[option]
	if !ok {
		// There may be multiple single-character options bunched together, e.g. `-itp 80`.
		if len(option) > 1 && option[0] == '-' && option[1] != '-' {
			// Make sure all options (except the last) exist and take no arguments.
			for _, ch := range option[1 : len(option)-1] {
				handler, ok = c.options[fmt.Sprintf("-%c", ch)]
				if !ok || handler != nil {
					ok = false
					break
				}
			}
			// If all earlier options are fine, use the arg handler for the last option.
			if ok {
				handler, ok = c.options[fmt.Sprintf("-%s", option[len(option)-1:])]
			}
		}
		if !ok {
			// The user may say `-foo` instead of `--foo`
			option = "-" + option
			handler, ok = c.options[option]
		}
	}
	if ok {
		if handler == nil {
			// This does not consume a value, and therefore doesn't need munging
			return []string{arg}, false, nil, nil
		}
		converted, cleanups, err := handler(value)
		if err != nil {
			// Note that we still need to pass along any cleanups even on failure
			return nil, consumed, cleanups, err
		}
		return []string{option, converted}, consumed, cleanups, nil
	}

	// Check if we can resolve this with the parent command.
	var extraCleanups []cleanupFunc
	parentName := ""
	if lastSpace := strings.LastIndex(c.commandPath, " "); lastSpace > -1 {
		parentName = c.commandPath[:lastSpace]
	}
	if parentName != c.commandPath {
		globalCommands := c.commands
		if globalCommands == nil {
			globalCommands = &commands
		}
		parent, ok := (*globalCommands)[parentName]
		if !ok {
			panic(fmt.Sprintf("command %q could not find parent %q", c.commandPath, parentName))
		}
		parentResult, parentConsumed, parentCleanups, parentErr := parent.parseOption(arg, next)
		if parentErr == nil {
			return parentResult, parentConsumed, parentCleanups, nil
		}
		extraCleanups = parentCleanups
	}
	return nil, false, extraCleanups, fmt.Errorf("command %q does not support option %s", c.commandPath, arg)
}

// parse arguments for this command; this includes options (--long, -x) as well
// as subcommands and positional arguments.
func (c commandDefinition) parse(args []string) (*parsedArgs, error) {
	// Parsing rules:
	// - At each command level, short options (-x) at that level can be parsed.
	// - At each command level, long options from the current or any previous level can be parsed.
	// - If a command contains positional arguments, it may not contain any subcommands.
	//   (We check this in `./generate` to make sure this stays true.)
	// - Positional arguments can be intermixed with (both long and short) options.
	// - If a command can have foreign flags (e.g. `nerdctl run`), we stop parsing
	//   options on first positional argument.  This means we parse the flag in
	//   `nerdctl run --env foo=bar image sh -c ...` but not the `--env` flag in
	//   `nerdctl run image --env foo=bar sh -c ...`.
	// - Having foreign flags is mutually exclusive with having subcommands; this
	//   is also checked in `./generate`.
	// - `--` stops parsing of options.
	var result parsedArgs
	var positionalArgs []string
	for argIndex := 0; argIndex < len(args); argIndex++ {
		arg := args[argIndex]
		if arg == "--" {
			// No more options, only positional arguments.
			positionalArgs = append(positionalArgs, args[argIndex+1:]...)
			break
		} else if strings.HasPrefix(arg, "-") {
			next := ""
			if argIndex+1 < len(args) {
				next = args[argIndex+1]
			}
			newArgs, consumed, cleanups, err := c.parseOption(arg, next)
			if err != nil {
				// We need to run any cleanups we have so far
				for _, cleanup := range append(cleanups, result.cleanup...) {
					cleanupErr := cleanup()
					if cleanupErr != nil {
						log.Printf("Error running cleanup: %s", cleanupErr)
					}
				}
				return nil, err
			}
			result.args = append(result.args, newArgs...)
			result.cleanup = append(result.cleanup, cleanups...)
			if consumed {
				argIndex++
			}
		} else if len(c.subcommands) > 0 {
			// This command has subcommands; assume any non-flags are subcommands.
			// Hand off argument parsing to the subcommand.
			subcommandPath := c.commandPath
			if subcommandPath != "" {
				subcommandPath += " "
			}
			subcommandPath += arg
			globalCommands := c.commands
			if globalCommands == nil {
				globalCommands = &commands
			}
			if subcommand, ok := (*globalCommands)[subcommandPath]; ok {
				childResult, err := subcommand.parse(args[argIndex+1:])
				if err != nil {
					return nil, err
				}
				result.args = append(result.args, arg)
				result.args = append(result.args, childResult.args...)
				result.cleanup = append(result.cleanup, childResult.cleanup...)
			} else {
				// Invalid subcommand; ignore positional arguments.
				result.args = append(result.args, args[argIndex:]...)
			}
			break
		} else {
			if c.hasForeignFlags {
				// If we have foreign flags, assume the rest of the arguments starting
				// from the first positional argument is foreign.
				positionalArgs = append(positionalArgs, args[argIndex:]...)
				break
			} else {
				// This command doesn't have subcommands, nor foreign arguments.
				// Everything is positional arguments; we still have to parse other
				// arguments for flags, though.
				positionalArgs = append(positionalArgs, arg)
			}
		}
	}
	// At this point, `result` is filled with options, and `positionalArgs`
	// contains the unparsed positional arguments.
	if c.handler != nil {
		childResult, err := c.handler(&c, positionalArgs, argHandlers)
		if err != nil {
			return nil, err
		}
		result.args = append(result.args, childResult.args...)
		result.cleanup = append(result.cleanup, childResult.cleanup...)
	} else {
		if len(positionalArgs) > 0 && !slices.Contains(result.args, "--") {
			result.args = slices.Concat(result.args, []string{"--"}, positionalArgs)
		} else {
			result.args = append(result.args, positionalArgs...)
		}
	}
	return &result, nil
}

// parseArgs parses the process arguments (os.Args) and returns them with any
// strings referring to paths replaced with replacements that will work with
// nerdctl (i.e. inside the correct WSL container).
func parseArgs() (*parsedArgs, error) {
	err := prepareParseArgs()
	if err != nil {
		return nil, err
	}
	result, err := commands[""].parse(os.Args[1:])
	if err != nil {
		_ = cleanupParseArgs()
		return nil, err
	}
	return result, nil
}

// ignoredArgHandler handles arguments that do not contain paths.
func ignoredArgHandler(input string) (string, []cleanupFunc, error) {
	return input, nil, nil
}

// registerArgHandler sets option handlers.  This should be called from init()
// to set up any option handlers that need to handle paths.
func registerArgHandler(command, option string, handler argHandler) {
	// Do some extra checking to guard against typos.
	if _, ok := commands[command]; !ok {
		panic(fmt.Sprintf("unknown command %q", command))
	}
	if _, ok := commands[command].options[option]; !ok {
		panic(fmt.Sprintf("command %q does not have option %q", command, option))
	}
	commands[command].options[option] = handler
}

// registerCommandHandler sets handlers for positional arguments.  This should
// be called from init().
func registerCommandHandler(command string, handler commandHandlerType) {
	// Do some extra checking to guard against typos.
	if _, ok := commands[command]; !ok {
		panic(fmt.Sprintf("unknown command %q", command))
	}
	c := commands[command]
	c.handler = handler
	commands[command] = c
}

// aliasCommand sets up an alias to a different command.  Both the alias and the
// target command must already exist and have the same options / subcommands (as
// it should already be an alias).  This is normally not needed for the help
// commands, as they do not take any arguments.
func aliasCommand(alias, target string) {
	aliasCommand, ok := commands[alias]
	if !ok {
		panic(fmt.Sprintf("unknown alias command %q", alias))
	}
	targetCommand, ok := commands[target]
	if !ok {
		panic(fmt.Sprintf("unknown target command %q", target))
	}

	// Try harder to check that the commands look similar
	if len(aliasCommand.subcommands) != len(targetCommand.subcommands) {
		panic(fmt.Sprintf("cannot alias %q to %q: different subcommands", alias, target))
	}
	for subcommand := range aliasCommand.subcommands {
		if _, ok := targetCommand.subcommands[subcommand]; !ok {
			panic(fmt.Sprintf("cannot alias %q to %q: missing subcommand %q", alias, target, subcommand))
		}
	}
	var aliasOnlyOptions []string
	var targetOnlyOptions []string
	for opt := range aliasCommand.options {
		if _, ok := targetCommand.options[opt]; !ok {
			aliasOnlyOptions = append(aliasOnlyOptions, opt)
		}
	}
	if len(aliasOnlyOptions) > 0 {
		panic(fmt.Sprintf("cannot alias %q to %q: alias-only options %s", alias, target, aliasOnlyOptions))
	}
	for opt := range targetCommand.options {
		if _, ok := aliasCommand.options[opt]; !ok {
			targetOnlyOptions = append(targetOnlyOptions, opt)
		}
	}
	if len(targetOnlyOptions) > 0 {
		panic(fmt.Sprintf("cannot alias %q to %q: target-only options %s", alias, target, targetOnlyOptions))
	}

	commands[alias] = commands[target]
}

func init() {
	// Set up the argument handlers
	registerArgHandler("builder build", "--build-context", argHandlers.buildContextArgHandler)
	registerArgHandler("builder build", "--cache-from", argHandlers.builderCacheArgHandler)
	registerArgHandler("builder build", "--cache-to", argHandlers.builderCacheArgHandler)
	registerArgHandler("builder build", "--file", argHandlers.filePathArgHandler)
	registerArgHandler("builder build", "-f", argHandlers.filePathArgHandler)
	registerArgHandler("builder build", "--iidfile", argHandlers.outputPathArgHandler)
	registerArgHandler("builder debug", "--file", argHandlers.filePathArgHandler)
	registerArgHandler("builder debug", "-f", argHandlers.filePathArgHandler)
	registerArgHandler("compose", "--file", argHandlers.filePathArgHandler)
	registerArgHandler("compose", "-f", argHandlers.filePathArgHandler)
	registerArgHandler("compose", "--project-directory", argHandlers.filePathArgHandler)
	registerArgHandler("compose", "--env-file", argHandlers.filePathArgHandler)
	registerArgHandler("compose run", "--volume", argHandlers.volumeArgHandler)
	registerArgHandler("compose run", "-v", argHandlers.volumeArgHandler)
	registerArgHandler("container create", "--cidfile", argHandlers.outputPathArgHandler)
	registerArgHandler("container create", "--cosign-key", argHandlers.filePathArgHandler)
	registerArgHandler("container create", "--env-file", argHandlers.filePathArgHandler)
	registerArgHandler("container create", "--label-file", argHandlers.filePathArgHandler)
	registerArgHandler("container create", "--mount", argHandlers.mountArgHandler)
	registerArgHandler("container create", "--pidfile", argHandlers.outputPathArgHandler)
	registerArgHandler("container create", "--volume", argHandlers.volumeArgHandler)
	registerArgHandler("container create", "-v", argHandlers.volumeArgHandler)
	registerArgHandler("container export", "--output", argHandlers.outputPathArgHandler)
	registerArgHandler("container export", "-o", argHandlers.outputPathArgHandler)
	registerArgHandler("container run", "--cidfile", argHandlers.outputPathArgHandler)
	registerArgHandler("container run", "--cosign-key", argHandlers.filePathArgHandler)
	registerArgHandler("container run", "--env-file", argHandlers.filePathArgHandler)
	registerArgHandler("container run", "--label-file", argHandlers.filePathArgHandler)
	registerArgHandler("container run", "--mount", argHandlers.mountArgHandler)
	registerArgHandler("container run", "--pidfile", argHandlers.outputPathArgHandler)
	registerArgHandler("container run", "--volume", argHandlers.volumeArgHandler)
	registerArgHandler("container run", "-v", argHandlers.volumeArgHandler)
	registerArgHandler("image convert", "--estargz-record-in", argHandlers.filePathArgHandler)
	registerArgHandler("image load", "--input", argHandlers.filePathArgHandler)
	registerArgHandler("image save", "--output", argHandlers.outputPathArgHandler)

	// Set up command handlers
	registerCommandHandler("builder build", builderBuildHandler)
	registerCommandHandler("container cp", containerCopyHandler)
	registerCommandHandler("image import", imageImportHandler)

	// Set up aliases
	aliasCommand("commit", "container commit")
	aliasCommand("cp", "container cp")
	aliasCommand("create", "container create")
	aliasCommand("exec", "container exec")
	aliasCommand("export", "container export")
	aliasCommand("kill", "container kill")
	aliasCommand("image build", "builder build")
	aliasCommand("import", "image import")
	aliasCommand("logs", "container logs")
	aliasCommand("pause", "container pause")
	aliasCommand("port", "container port")
	aliasCommand("rename", "container rename")
	aliasCommand("rm", "container rm")
	aliasCommand("run", "container run")
	aliasCommand("start", "container start")
	aliasCommand("stop", "container stop")
	aliasCommand("unpause", "container unpause")
	aliasCommand("wait", "container wait")
	aliasCommand("build", "builder build")
	aliasCommand("load", "image load")
	aliasCommand("pull", "image pull")
	aliasCommand("push", "image push")
	aliasCommand("save", "image save")
	aliasCommand("tag", "image tag")

	describeCommands()
}
