//go:build debug

/*
Copyright © 2024 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"fmt"
	"log"
	"sort"
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
