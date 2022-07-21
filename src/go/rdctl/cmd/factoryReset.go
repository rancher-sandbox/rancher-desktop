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
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var factoryResetData struct {
	KeepSystemImages bool `json:"keepSystemImages"`
}

var removeKubernetesCache bool

var factoryResetCmd = &cobra.Command{
	Use:   "factory-reset",
	Short: "Clear all the Rancher Desktop state and shut it down.",
	Long: `Clear all the Rancher Desktop state and shut it down.
Use the --remove-kubernetes-cache=BOOLEAN flag to also remove the cached Kubernetes images.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		err := cobra.NoArgs(cmd, args)
		if err != nil {
			return err
		}
		// Note that this command's only flag is default to not remove k8s cache
		// but the server takes an optional flag meaning the opposite (as per issues 1701 and 2408)
		factoryResetData.KeepSystemImages = !removeKubernetesCache
		jsonBuffer, err := json.Marshal(factoryResetData)
		if err != nil {
			return err
		}
		result, err := processRequestForUtility(doRequestWithPayload("PUT", versionCommand("", "factory_reset"), bytes.NewBuffer(jsonBuffer)))
		if err != nil {
			return err
		}
		fmt.Println(string(result))
		return nil
	},
}

func init() {
	rootCmd.AddCommand(factoryResetCmd)
	factoryResetCmd.Flags().BoolVar(&removeKubernetesCache, "remove-kubernetes-cache", false, "If specified, also removes the cached Kubernetes images.")
}
