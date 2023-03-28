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
	"fmt"

	"github.com/spf13/cobra"
)

var uninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Uninstall an RDX extension",
	Long: `rdctl extension uninstall <image-id>
The <image-id> is an image reference, e.g. splatform/epinio-docker-desktop:latest (the tag is optional).`,
  Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return uninstallExtension(args)
	},
}

func init() {
	extensionCmd.AddCommand(uninstallCmd)
}

func uninstallExtension(args []string) error {
	imageID := args[0]
	endpoint := fmt.Sprintf("/%s/extensions/uninstall?id=%s", apiVersion, imageID)
	result, errorPacket, err := processRequestForAPI(doRequest("POST", endpoint))
	if errorPacket != nil || err != nil {
		return displayAPICallResult([]byte{}, errorPacket, err)
	}
	msg := "no output from server"
	if result != nil {
		msg = string(result)
	}
	fmt.Printf("Uninstalling image %s: %s\n", imageID, msg)
	return nil
}
