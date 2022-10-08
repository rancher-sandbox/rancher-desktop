/*
Copyright © 2022 SUSE LLC

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

package cmd

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	dockerconfig "github.com/docker/docker/cli/config"
	"github.com/spf13/cobra"
)

const configFileName = "plaintext-credentials.config.json"

type dockerConfigType map[string]interface{}

type credType struct {
	ServerURL string `json:"ServerURL"`
	Username  string `json:"Username"`
	Secret    string `json:"Secret"`
}

var configFile string

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use: "docker-credential-none",
	Short: fmt.Sprintf(`Store docker credentials base64-encoded in ~/.docker/%s
using the same format that docker uses when no credsStore field is specified in ~/.docker/config.json.
This helper is intended for testing purposes, but will be used on Linux systems
unless 'pass' and/or 'secretservice' is available.`,
		configFileName),
	DisableSuggestions: true,
	SilenceUsage:       true,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main().
func Execute() {
	// Do our own validation. Default cobra validation is too verbose,
	// doesn't fit the docker-credentials-X protocol.

	if msg := validateArgs(); msg != "" {
		fmt.Println(msg)
		os.Exit(1)
	}

	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}

func init() {
	configFile = filepath.Join(dockerconfig.Dir(), configFileName)
}

func getParsedConfig() (dockerConfigType, error) {
	dockerConfig := make(dockerConfigType)
	contents, err := os.ReadFile(configFile)
	if err != nil {
		if errors.Is(err, syscall.ENOENT) {
			// Time to create a new config (or return no data)
			return dockerConfig, nil
		}
		return dockerConfig, err
	}
	err = json.Unmarshal(contents, &dockerConfig)
	if err != nil {
		return dockerConfig, fmt.Errorf("reading config file %s: %s", configFile, err)
	}
	return dockerConfig, nil
}

func getStandardInput() string {
	var chunks []string
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		chunks = append(chunks, scanner.Text())
	}
	return strings.TrimRight(strings.Join(chunks, ""), "\n")
}

func saveParsedConfig(config *dockerConfigType) error {
	contents, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	scratchFile, err := os.CreateTemp(dockerconfig.Dir(), "tmpconfig.json")
	if err != nil {
		return err
	}
	defer os.Remove(scratchFile.Name())
	err = os.WriteFile(scratchFile.Name(), contents, 0600)
	if err != nil {
		return err
	}
	return os.Rename(scratchFile.Name(), configFile)
}

/**
 * Make the error-messages less cobra-like. In particular, if help is requested, let cobra deal with it.
 * If there are any other non-help options, complain with the usage string.
 * If extra arguments are given, complain with the usage string.
 * If no subcommand is given, complain with the usage string.
 * If an unrecognized subcommand is given, complain with the "Unknown credential action" message.
 */
func validateArgs() string {
	const usage = "Usage: /usr/local/bin/docker-credential-none <store|get|erase|list>"
	if len(os.Args) == 1 {
		return usage
	}
	// Ignore help options
	var commandName string
	requestedHelp := false
	returnUsageIfHelpNotRequested := func() string {
		if requestedHelp {
			return ""
		}
		return usage
	}

	for _, arg := range os.Args[1:] {
		if arg == "" {
			return usage
		} else if arg == "help" {
			requestedHelp = true
		} else if arg[0] != '-' {
			if commandName != "" {
				// There are no subcommand arguments
				return returnUsageIfHelpNotRequested()
			}
			commandName = arg
		} else if arg == "--help" || strings.Index(arg, "-h") == 0 {
			requestedHelp = true
		} else {
			return returnUsageIfHelpNotRequested()
		}
	}
	if commandName == "" {
		return returnUsageIfHelpNotRequested()
	}
	commands := rootCmd.Commands()
	for _, cmd := range commands {
		if cmd.Name() == commandName {
			return ""
		}
	}
	return fmt.Sprintf("Unknown credential action `%s`", commandName)
}
