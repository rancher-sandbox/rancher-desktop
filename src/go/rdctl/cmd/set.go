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

type serverSettings struct {
	Kubernetes struct {
		ContainerEngine *string `json:"containerEngine,omitempty"`
		Enabled         *bool   `json:"enabled,omitempty"`
		Version         *string `json:"version,omitempty"`
	} `json:"kubernetes,omitempty"`
}

var specifiedSettings struct {
	ContainerEngine string
	Enabled         bool
	Version         string
}

// setCmd represents the set command
var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Update selected fields in the Rancher Desktop UI and restart the backend.",
	Long:  `Update selected fields in the Rancher Desktop UI and restart the backend.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) > 0 {
			return fmt.Errorf("set command: unrecognized command-line arguments specified: %v", args)
		}
		return doSetCommand(cmd)
	},
}

func init() {
	rootCmd.AddCommand(setCmd)
	setCmd.Flags().StringVar(&specifiedSettings.ContainerEngine, "container-engine", "", "Set engine to containerd or moby (aka docker).")
	setCmd.Flags().BoolVar(&specifiedSettings.Enabled, "kubernetes-enabled", false, "Control whether kubernetes runs in the backend.")
	setCmd.Flags().StringVar(&specifiedSettings.Version, "kubernetes-version", "", "Choose which version of kubernetes to run.")
}

func doSetCommand(cmd *cobra.Command) error {
	var currentSettings serverSettings
	changedSomething := false

	if cmd.Flags().Changed("container-engine") {
		currentSettings.Kubernetes.ContainerEngine = &specifiedSettings.ContainerEngine
		changedSomething = true
	}
	if cmd.Flags().Changed("kubernetes-enabled") {
		currentSettings.Kubernetes.Enabled = &specifiedSettings.Enabled
		changedSomething = true
	}
	if cmd.Flags().Changed("kubernetes-version") {
		currentSettings.Kubernetes.Version = &specifiedSettings.Version
		changedSomething = true
	}

	if !changedSomething {
		return fmt.Errorf("set command: no settings to change were given")
	}
	// No longer emit usage info on errors
	cmd.SetUsageFunc(func(*cobra.Command) error { return nil })
	jsonBuffer, err := json.Marshal(currentSettings)
	if err != nil {
		return err
	}
	result, err := processRequestForUtility(doRequestWithPayload("PUT", versionCommand("", "settings"), bytes.NewBuffer(jsonBuffer)))
	if err != nil {
		return err
	}
	if len(result) > 0 {
		fmt.Printf("Status: %s.\n", string(result))
	} else {
		fmt.Printf("Operation successfully returned with no output.")
	}
	return nil
}
