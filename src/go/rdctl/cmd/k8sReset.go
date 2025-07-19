/*
Copyright © 2025 SUSE LLC

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
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

var wipeReset bool

var k8sResetCmd = &cobra.Command{
	Use:   "k8s-reset",
	Short: "Reset the Kubernetes cluster",
	Long: `Clear the Kubernetes cluster and remove all associated data.
Use the --wipe=BOOLEAN flag to perform a more thorough reset, completely resetting the VM and removing all data.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		cmd.SilenceUsage = true
		paths, err := paths.GetPaths()
		if err != nil {
			return fmt.Errorf("failed to get paths: %w", err)
		}
		result, err := doK8sReset(cmd.Context(), paths, wipeReset)
		if err != nil {
			return err
		}
		fmt.Println(string(result))
		return nil
	},
}

func init() {
	rootCmd.AddCommand(k8sResetCmd)
	k8sResetCmd.Flags().BoolVar(&wipeReset, "wipe", false, "If specified, performs a more thorough reset of the Kubernetes cluster, removing all data. This is slower than the default fast mode.")
}

type ResetPayload struct {
	Mode string `json:"mode"`
}

func doK8sReset(ctx context.Context, appPaths *paths.Paths, wipeReset bool) ([]byte, error) {
	connectionInfo, err := config.GetConnectionInfo(false)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to get connection info: %w", err)
	}
	rdClient := client.NewRDClient(connectionInfo)
	command := client.VersionCommand("", "k8s_reset")

	mode := "fast"
	if wipeReset {
		mode = "wipe"
	}
	payload := ResetPayload{
		Mode: mode,
	}
	jsonBuffer, err := json.Marshal(payload)
	if err != nil {
		return []byte{}, err
	}
	buf := bytes.NewBuffer(jsonBuffer)
	result, err := client.ProcessRequestForUtility(rdClient.DoRequestWithPayload(ctx, http.MethodPut, command, buf))
	if err != nil {
		return result, err
	}

	return result, err
}
