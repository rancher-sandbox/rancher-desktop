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
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/spf13/cobra"
)

// lsCmd represents the ls command
var lsCmd = &cobra.Command{
	Use:     "ls",
	Aliases: []string{"list"},
	Short:   "List currently installed images",
	Long:    `List currently installed images.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) > 0 {
			return fmt.Errorf("rdctl extension ls takes no additional arguments, got %s", args)
		}
		cmd.SilenceUsage = true
		return listExtensions()
	},
}

func init() {
	extensionCmd.AddCommand(lsCmd)
}

func listExtensions() error {
	endpoint := fmt.Sprintf("/%s/extensions", apiVersion)
	result, errorPacket, err := processRequestForAPI(doRequest("GET", endpoint))
	if errorPacket != nil || err != nil {
		return displayAPICallResult([]byte{}, errorPacket, err)
	}
	extensionList := map[string]struct {
		Version string `json:"version"`
	}{}
	err = json.Unmarshal(result, &extensionList)
	if err != nil {
		return fmt.Errorf("failed to json-unmarshal results of `extensions ls`: %w", err)
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
