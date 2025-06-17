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
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	options "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/options/generated"
)

// setCmd represents the set command
var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Update selected fields in the Rancher Desktop UI and restart the backend.",
	Long:  `Update selected fields in the Rancher Desktop UI and restart the backend.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		return doSetCommand(cmd)
	},
}

func init() {
	rootCmd.AddCommand(setCmd)
	options.UpdateCommonStartAndSetCommands(setCmd)
}

func doSetCommand(cmd *cobra.Command) error {
	connectionInfo, err := config.GetConnectionInfo(false)
	if err != nil {
		return fmt.Errorf("failed to get connection info: %w", err)
	}
	rdClient := client.NewRDClient(connectionInfo)

	changedSettings, err := options.UpdateFieldsForJSON(cmd.Flags())
	if err != nil {
		cmd.SilenceUsage = true
		return err
	} else if changedSettings == nil {
		return fmt.Errorf("%s command: no settings to change were given", cmd.Name())
	}
	cmd.SilenceUsage = true
	jsonBuffer, err := json.Marshal(changedSettings)
	if err != nil {
		return err
	}

	command := client.VersionCommand("", "settings")
	buf := bytes.NewBuffer(jsonBuffer)
	result, err := client.ProcessRequestForUtility(rdClient.DoRequestWithPayload(cmd.Context(), http.MethodPut, command, buf))
	if err != nil {
		return err
	}
	if len(result) > 0 {
		fmt.Printf("Status: %s.\n", string(result))
	} else {
		fmt.Printf("Operation successfully returned with no output.")
	}
	return nil
}
