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
	"fmt"
	"os"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/integration"
	"github.com/sirupsen/logrus"
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
		pluginDir := wslIntegrationDockerPluginViper.GetString("plugin-dir")
		binDir := wslIntegrationDockerPluginViper.GetString("bin-dir")
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to locate home directory: %w", err)
		}

		if err := integration.SetupPluginDirConfig(homeDir, pluginDir, state); err != nil {
			return err
		}

		if err := integration.RemoveObsoletePluginSymlinks(homeDir, binDir); err != nil {
			return err
		}

		return nil
	},
}

func init() {
	wslIntegrationDockerPluginCmd.Flags().String("plugin-dir", "", "Full path to plugin directory")
	wslIntegrationDockerPluginCmd.Flags().String("bin-dir", "", "Full path to bin directory to clean up deprecated links")
	wslIntegrationDockerPluginCmd.Flags().Bool("state", false, "Desired state")
	if err := wslIntegrationDockerPluginCmd.MarkFlagRequired("plugin-dir"); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	wslIntegrationDockerPluginViper.AutomaticEnv()
	if err := wslIntegrationDockerPluginViper.BindPFlags(wslIntegrationDockerPluginCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	wslIntegrationCmd.AddCommand(wslIntegrationDockerPluginCmd)
}
