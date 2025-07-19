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
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/factoryreset"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/shutdown"
)

var (
	factoryReset bool
	k8sReset     bool
)

var resetCmd = &cobra.Command{
	Use:   "reset",
	Short: "Reset Rancher Desktop",
	Long: `Reset Rancher Desktop with various options:
* Default: Delete the VM and create a new one with current settings
* --factory: Also delete current settings and show first-run dialog on next start
* --k8s: Delete only the Kubernetes control plane data. When passed with --factory, the k8s cache will also be cleared`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		cmd.SilenceUsage = true

		if factoryReset {
			// Factory reset: same as current factory-reset command
			return performFactoryReset(cmd.Context(), k8sReset)
		}
		result, err := doReset(cmd.Context(), k8sReset)
		if err != nil {
			return err
		}
		fmt.Println(string(result))
		return nil
	},
}

// performFactoryReset performs a factory reset with the given context and cache removal option
func performFactoryReset(ctx context.Context, removeCache bool) error {
	pathsCfg, err := paths.GetPaths()
	if err != nil {
		return fmt.Errorf("failed to get paths: %w", err)
	}
	commonShutdownSettings.WaitForShutdown = false
	_, err = doShutdown(ctx, &commonShutdownSettings, shutdown.FactoryReset)
	if err != nil {
		return err
	}
	return factoryreset.DeleteData(ctx, pathsCfg, removeCache)
}

// ResetPayload defines the payload structure for reset requests
type ResetPayload struct {
	Mode string `json:"mode"`
}

// doReset performs a reset with the specified wipe mode
func doReset(ctx context.Context, k8sOnly bool) ([]byte, error) {
	connectionInfo, err := config.GetConnectionInfo(false)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to get connection info: %w", err)
	}
	rdClient := client.NewRDClient(connectionInfo)
	command := client.VersionCommand("", "k8s_reset")

	mode := "wipe"
	if k8sOnly {
		mode = "fast"
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

func init() {
	rootCmd.AddCommand(resetCmd)
	resetCmd.Flags().BoolVar(&factoryReset, "factory", false, "Factory reset: delete current settings and show first-run dialog on next start")
	resetCmd.Flags().BoolVar(&k8sReset, "k8s", false, "Delete only the Kubernetes control plane data. When passed with --factory, the k8s cache will also be cleared")
}
