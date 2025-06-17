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

package cmd

import (
	"fmt"
	"os"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
)

var processSpawnViper = viper.New()

// processSpawnCmd is the `wsl-helper process spawn` command.
var processSpawnCmd = &cobra.Command{
	Use:   "spawn",
	Short: "Spawn a new process",
	Long: `Spawn a new process, attached to a job that would be terminated when
	the given parent process exits.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		ppid := processSpawnViper.GetUint32("parent")

		if ppid == 0 {
			ppid = uint32(os.Getpid())
		}

		state, err := process.SpawnProcessInRDJob(ppid, args)
		if err != nil {
			return fmt.Errorf("failed to spawn process: %w", err)
		}

		os.Exit(state.ExitCode())
		return nil
	},
}

func init() {
	processSpawnCmd.Flags().Uint32("parent", 0, "PID of the parent process")
	processSpawnViper.AutomaticEnv()
	if err := processSpawnViper.BindPFlags(processSpawnCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	processCmd.AddCommand(processSpawnCmd)
}
