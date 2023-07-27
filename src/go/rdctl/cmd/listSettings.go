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
)

// listSettingsCmd represents the listSettings command
var listSettingsCmd = &cobra.Command{
	Use:   "list-settings",
	Short: "Lists the current settings.",
	Long:  `Lists the current settings in JSON format.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		cmd.SilenceUsage = true
		result, err := getListSettings()
		if err != nil {
			return err
		}
		fmt.Println(string(result))
		return nil
	},
}

func init() {
	rootCmd.AddCommand(listSettingsCmd)
}

func getListSettings() ([]byte, error) {
	return processRequestForUtility(doRequest("GET", versionCommand("", "settings")))
}
