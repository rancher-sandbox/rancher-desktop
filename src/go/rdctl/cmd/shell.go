/*
Copyright © 2025 SUSE LLC

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
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/command"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/shell"
)

// shellCmd represents the shell command
var shellCmd = &cobra.Command{
	Use:   "shell",
	Short: "Run an interactive shell or a command in a Rancher Desktop-managed VM",
	Long: `Run an interactive shell or a command in a Rancher Desktop-managed VM. For example:

> rdctl shell
-- Runs an interactive shell
> rdctl shell ls -CF /tmp
-- Runs 'ls -CF' from /tmp on the VM
> rdctl shell bash -c "cd .. ; pwd"
-- Usual way of running multiple statements on a single call
`,
	DisableFlagParsing: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Do manual flag parsing looking to see if we should give help instead.
		if len(args) > 0 && (args[0] == "-h" || args[0] == "--help") {
			return cmd.Help()
		}
		return doShellCommand(cmd, args)
	},
}

func init() {
	rootCmd.AddCommand(shellCmd)
}

func doShellCommand(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true

	ctx := command.WithCommandName(cmd.Context(), cmd.CommandPath())
	shellCommand, err := shell.SpawnCommand(ctx, args...)
	if err != nil {
		var fatalError command.FatalError
		if errors.As(err, &fatalError) {
			if fatalError.Error() != "" {
				_, _ = fmt.Fprintln(os.Stderr, fatalError)
			}
			os.Exit(fatalError.ExitCode())
		}
		return err
	}
	shellCommand.Stdin = os.Stdin
	shellCommand.Stdout = os.Stdout
	shellCommand.Stderr = os.Stderr
	return shellCommand.Run()
}
