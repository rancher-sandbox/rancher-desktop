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
	"context"
	"fmt"
	"net/http"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/shutdown"
)

type shutdownSettingsStruct struct {
	WaitForShutdown bool
}

var commonShutdownSettings shutdownSettingsStruct

// shutdownCmd represents the shutdown command
var shutdownCmd = &cobra.Command{
	Use:   "shutdown",
	Short: "Shuts down the running Rancher Desktop application",
	Long:  `Shuts down the running Rancher Desktop application.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		cmd.SilenceUsage = true
		result, err := doShutdown(cmd.Context(), &commonShutdownSettings, shutdown.Shutdown)
		if err != nil {
			return err
		}
		if result != nil {
			fmt.Println(string(result))
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(shutdownCmd)
	shutdownCmd.Flags().BoolVar(&commonShutdownSettings.WaitForShutdown, "wait", true, "wait for shutdown to be confirmed")
}

func doShutdown(ctx context.Context, shutdownSettings *shutdownSettingsStruct, initiatingCommand shutdown.InitiatingCommand) ([]byte, error) {
	var output []byte
	connectionInfo, err := config.GetConnectionInfo(true)
	if err == nil && connectionInfo != nil {
		rdClient := client.NewRDClient(connectionInfo)
		command := client.VersionCommand("", "shutdown")
		output, _ = client.ProcessRequestForUtility(rdClient.DoRequest(ctx, http.MethodPut, command))
		logrus.WithError(err).Trace("Shut down requested")
	}
	err = shutdown.FinishShutdown(ctx, shutdownSettings.WaitForShutdown, initiatingCommand)
	return output, err
}
