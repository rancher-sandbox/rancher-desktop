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

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/integration"
)

var wslIntegrationStateViper = viper.New()

// wslIntegrationStateCmd represents the `wsl integration state` command.
var wslIntegrationStateCmd = &cobra.Command{
	Use:   "state",
	Short: "Manage markers for WSL integration state",
	Long:  "Manage markers for Rancher Desktop WSL distro integration state",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true

		mode := cmd.Flags().Lookup("mode").Value.String()
		switch mode {
		case "show":
			return integration.Show()
		case "set":
			logrus.Trace("Setting wsl integration state marker")
			return integration.Set()
		case "delete":
			logrus.Trace("Deleting wsl integration state marker")
			return integration.Delete()
		default:
			return fmt.Errorf("unknown operation %q", mode)
		}
	},
}

func init() {
	wslIntegrationStateCmd.Flags().Var(&enumValue{val: "show", allowed: []string{"show", "set", "delete"}}, "mode", "Operation mode")
	if err := wslIntegrationStateCmd.MarkFlagRequired("mode"); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	wslIntegrationStateViper.AutomaticEnv()
	if err := wslIntegrationStateViper.BindPFlags(wslIntegrationStateCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	wslIntegrationCmd.AddCommand(wslIntegrationStateCmd)
}
