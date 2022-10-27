//go:build debug
// +build debug

package main

import (
	"fmt"
)

// describeCommands is a debugging function that prints out all commands.
// This is normally never called, but we keep this implemented as it is useful
// for debugging.
func describeCommands() {
	handlerNames := make(map[string]string)
	handlerNames[fmt.Sprintf("%v", nil)] = "~"
	// The next few lines should ignore govet's "printf" lint because we are
	// intentionally printing a function instead of calling it.
	handlerNames[fmt.Sprintf("%v", ignoredArgHandler)] = "ignored"        //nolint:govet,printf
	handlerNames[fmt.Sprintf("%v", volumeArgHandler)] = "volume"          //nolint:govet,printf
	handlerNames[fmt.Sprintf("%v", filePathArgHandler)] = "file path"     //nolint:govet,printf
	handlerNames[fmt.Sprintf("%v", outputPathArgHandler)] = "output path" //nolint:govet,printf

	log.Println("========== COMMAND STRUCTURE ==========")
	var paths []string
	for path := range commands {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		command := commands[path]
		log.Printf("%-20s %v", path, command.handler) //nolint:govet,printf
		var optionNames []string
		for optionName := range command.options {
			optionNames = append(optionNames, optionName)
		}
		sort.Strings(optionNames)
		for _, optionName := range optionNames {
			handler := command.options[optionName]
			handlerName, ok := handlerNames[fmt.Sprintf("%v", handler)]
			if !ok {
				handlerName = "<invalid handler>"
			}
			log.Printf("%20s %s", optionName, handlerName)
		}
	}
	log.Println("========== END COMMAND STRUCTURE ==========")
}
