//go:build windows
// +build windows

/*
Copyright © 2021 SUSE LLC

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
	"encoding/json"
	"os"

	wslutils "github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/wsl-utils"
	"github.com/spf13/cobra"
)

// wslInfoCmd represents the `wsl info` command.
var wslInfoCmd = &cobra.Command{
	Use:   "info",
	Short: "Determine information about the installed WSL",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		info, err := wslutils.GetWSLInfo(cmd.Context())
		if err != nil {
			return err
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		err = encoder.Encode(info)
		if err != nil {
			return err
		}
		return nil
	},
}

func init() {
	wslCmd.AddCommand(wslInfoCmd)
}
