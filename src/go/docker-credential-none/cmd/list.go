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
	"strings"

	"github.com/spf13/cobra"
)

// listCmd represents the list command
var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List the URLs that have stored associated credentials.",
	Long:  `List the URLs that have stored associated credentials.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return doList()
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
	var urls []string
	authsInterface, ok := config["auths"]
	if ok {
		auths := authsInterface.(map[string]interface{})
		for url := range auths {
			urls = append(urls, url)
		}
	}
	fmt.Printf("[%s]\n", strings.Join(urls, ", "))
	return nil
}
