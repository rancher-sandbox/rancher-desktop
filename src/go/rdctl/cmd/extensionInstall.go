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

var forceInstall bool

// installCmd represents the 'rdctl extensions install' command
var installCmd = &cobra.Command{
	Use:   "install",
	Short: "Install an RDX extension",
	Long: `rdctl extension install [--force] <image-id>
--force: avoid any interactivity.
The <image-id> is an image reference, e.g. splatform/epinio-docker-desktop:latest (the tag is optional).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			return fmt.Errorf("no image specified")
		}
		if len(args) >= 2 {
			return fmt.Errorf("too many arguments specified")
		}
		cmd.SilenceUsage = true
		return installExtension(args)
	},
}

func init() {
	extensionCmd.AddCommand(installCmd)
	installCmd.Flags().BoolVarP(&forceInstall, "force", "", true, "Avoid interactivity")
}

func installExtension(args []string) error {
	imageID := args[0]
	//TODO: How do we use `forceInstall` ?
	endpoint := fmt.Sprintf("/%s/extensions/install?id=%s", apiVersion, imageID)
	// https://stackoverflow.com/questions/20847357/golang-http-client-always-escaped-the-url
	// Looks like http.NewRequest(method, url) escapes the URL

	result, errorPacket, err := processRequestForAPI(doRequest("POST", endpoint))
	if errorPacket != nil || err != nil {
		if result != nil {
			return fmt.Errorf("installation failed: %s\n", string(result))
		}
		return displayAPICallResult([]byte{}, errorPacket, err)
	}
	if string(result) == "Created" {
		fmt.Printf("%s image %s\n", string(result), imageID)
	} else if len(result) > 0 {
		fmt.Printf("%s\n", imageID)
	}
	return nil
}
