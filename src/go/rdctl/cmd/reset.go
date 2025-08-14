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
	vmReset      bool
	k8sReset     bool
	cacheReset   bool
	factoryReset bool
)

var resetCmd = &cobra.Command{
	Use:   "reset",
	Short: "Reset Rancher Desktop",
	Long: `Delete parts of Rancher Desktop settings.
Some reset options are combinations of others:

  * --factory includes --vm and --k8s (but not --cache)
  * --vm includes --k8s

At least one option must be specified.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		cmd.SilenceUsage = true

		// Check if any options are specified
		if !vmReset && !k8sReset && !cacheReset && !factoryReset {
			return fmt.Errorf("no reset options specified. Use --help to see available options")
		}

		// Handle factory reset (includes VM, K8s and possibly cache reset)
		if factoryReset {
			return performFactoryReset(cmd.Context(), cacheReset)
		}
		if vmReset || k8sReset {
			resetType := "wipe"
			if !vmReset {
				resetType = "fast"
			}
			result, err := doReset(cmd.Context(), resetType)
			if err != nil {
				return err
			}
			fmt.Println(string(result))
		}
		// Handle cache reset if requested (and not already handled by factory reset)
		if cacheReset {
			return factoryreset.DeleteCacheData()
		}

		return nil
	},
}

// resetPayload defines the payload structure for reset requests
type resetPayload struct {
	Mode string `json:"mode"`
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

// doReset performs a reset with the specified mode
func doReset(ctx context.Context, mode string) ([]byte, error) {
	connectionInfo, err := config.GetConnectionInfo(false)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to get connection info: %w", err)
	}
	rdClient := client.NewRDClient(connectionInfo)
	command := client.VersionCommand("", "k8s_reset")

	payload := resetPayload{
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
	resetCmd.Flags().BoolVar(&vmReset, "vm", false, "Delete VM and create a new one with current settings")
	resetCmd.Flags().BoolVar(&k8sReset, "k8s", false, "Delete deployed Kubernetes workloads")
	resetCmd.Flags().BoolVar(&cacheReset, "cache", false, "Delete cached Kubernetes images")
	resetCmd.Flags().BoolVar(&factoryReset, "factory", false, "Delete VM and show first-run dialog on next start")
}
