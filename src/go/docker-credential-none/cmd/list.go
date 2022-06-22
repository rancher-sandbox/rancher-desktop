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
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
)

// listCmd represents the list command
var listCmd = &cobra.Command{
	Use:   "list",
	Short: "Output a JSON-like object of URLs mapped to associated usernames for all the stored credentials.",
	RunE: func(cmd *cobra.Command, args []string) error {
		payload, err := doList()
		if err != nil {
			cmd.SilenceUsage = true
			return err
		}
		fmt.Printf("%s\n", payload)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(listCmd)
}

func doList() (string, error) {
	config, err := getParsedConfig()
	if err != nil {
		return "", err
	}
	entries := make(map[string]string)
	authsInterface, ok := config["auths"]
	if ok {
		auths, ok := authsInterface.(map[string]interface{})
		if !ok {
			return "", fmt.Errorf("Unexpected data: %v: not a hash\n", authsInterface)
		}
		for url := range auths {
			userdata, err := getRecordForServerURL(&config, url)
			if err == nil && userdata.Username != "" {
				entries[url] = userdata.Username
			}
			// Other cases are ignored when doing List
		}
	}
	b, err := json.Marshal(entries)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
