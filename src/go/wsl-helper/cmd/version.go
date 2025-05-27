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

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/version"
)

// showVersionCmd represents the showVersion command
var showVersionCmd = &cobra.Command{
	Use:   "version",
	Short: "Shows the wsl-helper version.",
	Long:  `Shows the wsl-helper version.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := fmt.Printf("wsl-helper version: %s\n", version.Version)
		return err
	},
}

func init() {
	rootCmd.AddCommand(showVersionCmd)
}
