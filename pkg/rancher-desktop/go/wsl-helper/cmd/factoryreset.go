//go:build windows
// +build windows

/*
Copyright © 2021 SUSE LLC

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
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/reset"
)

var factoryResetViper = viper.New()

// factoryResetCmd represents the `wsl-helper factory-reset`
var factoryResetCmd = &cobra.Command{
	Use:    "factory-reset",
	Short:  "Commands for interacting with k3s in WSL",
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		pid := factoryResetViper.GetUint32("wait-pid")
		if pid != 0 {
			if err := process.WaitPid(pid); err != nil {
				return err
			}
		}
		keepSystemImages := factoryResetViper.GetBool("keep-system-images")
		if err := reset.FactoryReset(keepSystemImages); err != nil {
			return err
		}
		launch := factoryResetViper.GetString("launch")
		if launch != "" {
			if err := process.Launch(launch); err != nil {
				return err
			}
		}
		return nil
	},
}

func init() {
	factoryResetCmd.Flags().Uint32("wait-pid", 0, "Wait for given process to exit before starting")
	factoryResetCmd.Flags().String("launch", "", "Launch process when done")
	factoryResetCmd.Flags().Bool("keep-system-images", false, "Keep the system images")
	factoryResetViper.AutomaticEnv()
	factoryResetViper.BindPFlags(factoryResetCmd.Flags())
	rootCmd.AddCommand(factoryResetCmd)
}
