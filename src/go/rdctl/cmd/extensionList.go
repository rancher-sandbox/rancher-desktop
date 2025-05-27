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

// Package cmd implements the rdctl commands

package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
)

// listCmd represents the list command
var listCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List currently installed images",
	Long:    `List currently installed images.`,
	Args:    cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return listExtensions(cmd.Context())
	},
}

func init() {
	extensionCmd.AddCommand(listCmd)
}

func listExtensions(ctx context.Context) error {
	connectionInfo, err := config.GetConnectionInfo(false)
	if err != nil {
		return fmt.Errorf("failed to get connection info: %w", err)
	}
	rdClient := client.NewRDClient(connectionInfo)
	endpoint := fmt.Sprintf("/%s/extensions", client.APIVersion)
	result, errorPacket, err := client.ProcessRequestForAPI(rdClient.DoRequest(ctx, http.MethodGet, endpoint))
	if errorPacket != nil || err != nil {
		return displayAPICallResult([]byte{}, errorPacket, err)
	}
	extensionList := map[string]struct {
		Version string `json:"version"`
	}{}
	err = json.Unmarshal(result, &extensionList)
	if err != nil {
		return fmt.Errorf("failed to unmarshal extension list API response: %w", err)
	}
	if len(extensionList) == 0 {
		fmt.Println("No extensions are installed.")
		return nil
	}
	extensionIDs := make([]string, 0, len(extensionList))
	for id, info := range extensionList {
		extensionIDs = append(extensionIDs, fmt.Sprintf("%s:%s", id, info.Version))
	}
	sort.Slice(extensionIDs, func(i, j int) bool { return strings.ToLower(extensionIDs[i]) < strings.ToLower(extensionIDs[j]) })

	fmt.Print("Extension IDs\n\n")
	for _, extensionID := range extensionIDs {
		fmt.Println(extensionID)
	}
	return nil
}
