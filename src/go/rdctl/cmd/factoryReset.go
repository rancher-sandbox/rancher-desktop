/*
Copyright © 2022 SUSE LLC

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
	"runtime"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

var removeKubernetesCache bool

// Note that this command supports a `--remove-kubernetes-cache` flag,
// but the server takes an optional flag meaning the opposite (as per issues
// https://github.com/rancher-sandbox/rancher-desktop/issues/1701 and
// https://github.com/rancher-sandbox/rancher-desktop/issues/2408)

var factoryResetCmd = &cobra.Command{
	Use:   "factory-reset",
	Short: "Clear all the Rancher Desktop state and shut it down.",
	Long: `Clear all the Rancher Desktop state and shut it down.
Use the --remove-kubernetes-cache=BOOLEAN flag to also remove the cached Kubernetes images.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		if commonShutdownSettings.Verbose {
			logrus.SetLevel(logrus.TraceLevel)
		}
		cmd.SilenceUsage = true
		commonShutdownSettings.WaitForShutdown = runtime.GOOS == "windows"
		_, err := doShutdown(&commonShutdownSettings)
		if err != nil {
			return err
		}
		return factoryreset.DeleteData(removeKubernetesCache)
	},
}

func init() {
	rootCmd.AddCommand(factoryResetCmd)
	factoryResetCmd.Flags().BoolVar(&removeKubernetesCache, "remove-kubernetes-cache", false, "If specified, also removes the cached Kubernetes images.")
	factoryResetCmd.Flags().BoolVar(&commonShutdownSettings.Verbose, "verbose", false, "Be verbose")
}
