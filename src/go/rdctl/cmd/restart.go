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
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/shutdown"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

// restartCmd represents the restart command
var restartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Restart the running Rancher Desktop application",
	Long:  `Restart the running Rancher Desktop application.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		if commonShutdownSettings.Verbose {
			logrus.SetLevel(logrus.TraceLevel)
		}
		commonShutdownSettings.WaitForShutdown = true
		cmd.SilenceUsage = true
		result, err := doShutdown(&commonShutdownSettings, shutdown.Shutdown)
		if err != nil {
			return err
		}
		if result != nil {
			fmt.Println(string(result))
		}
		return doStartOrSetCommand(cmd)
	},
}

func init() {
	rootCmd.AddCommand(restartCmd)
	restartCmd.Flags().BoolVar(&commonShutdownSettings.Verbose, "verbose", false, "be verbose")
	restartCmd.Flags().StringVarP(&applicationPath, "path", "p", "", "path to main executable")
	restartCmd.Flags().BoolVarP(&noModalDialogs, "no-modal-dialogs", "", false, "avoid displaying dialog boxes")
}
