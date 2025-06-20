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
	"fmt"
	"net/http"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
)

var uninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Uninstall an RDX extension",
	Long: `rdctl extension uninstall <image-id>
The <image-id> is an image reference, e.g. splatform/epinio-docker-desktop:latest (the tag is optional).`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return uninstallExtension(cmd.Context(), args)
	},
}

func init() {
	extensionCmd.AddCommand(uninstallCmd)
}

func uninstallExtension(ctx context.Context, args []string) error {
	connectionInfo, err := config.GetConnectionInfo(false)
	if err != nil {
		return fmt.Errorf("failed to get connection info: %w", err)
	}
	rdClient := client.NewRDClient(connectionInfo)
	imageID := args[0]
	endpoint := fmt.Sprintf("/%s/extensions/uninstall?id=%s", client.APIVersion, imageID)
	result, errorPacket, err := client.ProcessRequestForAPI(rdClient.DoRequest(ctx, http.MethodPost, endpoint))
	if errorPacket != nil || err != nil {
		return displayAPICallResult(result, errorPacket, err)
	}
	msg := "no output from server"
	if result != nil {
		msg = string(result)
	}
	fmt.Printf("Uninstalling image %s: %s\n", imageID, msg)
	return nil
}
