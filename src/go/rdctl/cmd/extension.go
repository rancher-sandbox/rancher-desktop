/*
Copyright © 2023 SUSE LLC

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

// extensionCmd represents the extension command
var extensionCmd = &cobra.Command{
	Short: "Manage extensions",
	Long: `rdctl extension - manage installed extensions
`,
	Use: "extension [install | uninstall | list] [options...]",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return fmt.Errorf("No subcommand given.\n\nUsage: rdctl %s", cmd.Use)
	},
}

func init() {
	rootCmd.AddCommand(extensionCmd)
}
