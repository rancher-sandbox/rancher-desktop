//go:build unix

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

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
)

// internalCmd represents the `rdctl internal process` command, which contains
// commands for dealing with (host) processes.
var internalProcessWaitKillCmd = &cobra.Command{
	Use:   "wait-kill",
	Short: "Wait for a process and then kill of the processes in its group.",
	Long: `The 'rdctl internal process wait-kill' command waits for the specified process to
exit, and once it does, terminates all processes within the same process group.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		pid, err := cmd.Flags().GetInt("pid")
		if err != nil {
			return fmt.Errorf("failed to get process ID: %w", err)
		}
		return process.KillProcessGroup(pid, true)
	},
}

func init() {
	internalProcessCmd.AddCommand(internalProcessWaitKillCmd)
	internalProcessWaitKillCmd.Flags().Int("pid", 0, "process to wait for")
	_ = internalProcessWaitKillCmd.MarkFlagRequired("pid")
}
