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

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/process"
)

var killProcessViper = viper.New()

// killProcessCmd is the `wsl-helper kill-process` command.
var killProcessCmd = &cobra.Command{
	Use:   "kill-process",
	Short: "Kill a given process",
	RunE: func(cmd *cobra.Command, args []string) error {
		return process.Kill(killProcessViper.GetInt("pid"))
	},
}

func init() {
	killProcessCmd.Flags().Int("pid", 0, "PID of process to kill")
	killProcessViper.AutomaticEnv()
	killProcessViper.BindPFlags(killProcessCmd.Flags())
	rootCmd.AddCommand(killProcessCmd)
}
