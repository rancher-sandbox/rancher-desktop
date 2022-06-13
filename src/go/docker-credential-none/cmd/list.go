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
	"os"
)

// listCmd represents the list command
var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List the URLs that have stored associated credentials.",
	Long:  `List the URLs that have stored associated credentials.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		err := doList()
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s\n", err)
		}
		// list never fails
		return nil
	},
}

func init() {
	rootCmd.AddCommand(listCmd)
}

func doList() error {
	config, err := getParsedConfig()
	if err != nil {
		return err
	}
	entries := make(map[string]string)
	authsInterface, ok := config["auths"]
	if ok {
		auths := authsInterface.(map[string]interface{})
		for url := range auths {
			username, _, err := getCredentialPair(&config, url)
			if err != nil {
				fmt.Fprintf(os.Stderr, "%s\n", err)
				continue
			}
			if username != "" {
				entries[url] = username
			}
		}
	}
	b, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	fmt.Printf("%s\n", string(b))
	return nil
}
