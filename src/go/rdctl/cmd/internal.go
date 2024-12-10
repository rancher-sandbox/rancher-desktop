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

// Package cmd implements the rdctl commands
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

// internalCmd represents the `rdctl internal` command, which is used for
// native code.
var internalCmd = &cobra.Command{
	Use:    "internal",
	Short:  "Rancher Desktop internal commands",
	Long:   `rdctl internal provides commands for Rancher Desktop internal use`,
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return fmt.Errorf("%q expects subcommands", cmd.CommandPath())
	},
}

func init() {
	rootCmd.AddCommand(internalCmd)
}
