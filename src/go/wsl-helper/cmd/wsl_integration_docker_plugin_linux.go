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
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/integration"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var wslIntegrationDockerPluginViper = viper.New()

// wslIntegrationDockerPluginCmd represents the `wsl integration docker-plugin` command
var wslIntegrationDockerPluginCmd = &cobra.Command{
	Use:   "docker-plugin",
	Short: "Commands for managing docker plugin WSL integration",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true

		state := wslIntegrationDockerPluginViper.GetBool("state")
		pluginPath := wslIntegrationDockerPluginViper.GetString("plugin")

		if err := integration.DockerPlugin(pluginPath, state); err != nil {
			return err
		}

		return nil
	},
}

func init() {
	wslIntegrationDockerPluginCmd.Flags().String("plugin", "", "Full path to plugin")
	wslIntegrationDockerPluginCmd.Flags().Bool("state", false, "Desired state")
	wslIntegrationDockerPluginCmd.MarkFlagRequired("plugin")
	wslIntegrationDockerPluginViper.AutomaticEnv()
	wslIntegrationDockerPluginViper.BindPFlags(wslIntegrationDockerPluginCmd.Flags())
	wslIntegrationCmd.AddCommand(wslIntegrationDockerPluginCmd)
}
