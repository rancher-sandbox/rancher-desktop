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

// Package cmd is the main package for this CLI
package cmd

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:               "rdctl",
	Short:             "A CLI for Rancher Desktop",
	Long:              `The eventual goal of this CLI is to enable any UI-based operation to be done from the command-line as well.`,
	PersistentPreRunE: config.PersistentPreRunE,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	if len(os.Args) > 1 {
		mainCommand := os.Args[1]
		if mainCommand == "-h" || mainCommand == "help" || mainCommand == "--help" {
			if len(os.Args) > 2 {
				mainCommand = os.Args[2]
			}
		}
		if mainCommand == "shell" || mainCommand == "version" || mainCommand == "completion" {
			return
		}
	}
	config.DefineGlobalFlags(rootCmd)
}
