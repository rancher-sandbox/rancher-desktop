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
	"os"
	"strings"
)

type serverSettings struct {
  Kubernetes struct {
    ContainerEngine   string `json:"containerEngine"`
    Enabled bool `json:"enabled"`
    Version string `json:"version"`
  } `json:"kubernetes,omitempty"`
}

var specifiedSettings serverSettings

// setCmd represents the set command
var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Update selected fields in the Rancher Desktop UI and restart the backend.",
	Long: `The following options are supported:
    --container-engine=containerd|moby
    --kubernetes-enabled=true|false
    --kubernetes-version=VERSION

The '=' sign can be replaced by one or more spaces.
'docker' is an accepted synonym for 'moby'.
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) > 0 {
			return fmt.Errorf("set command: unrecognized command-line arguments specified: %v", args)
		}
		return doSetCommand()
	},
}

func init() {
	rootCmd.AddCommand(setCmd)
	setCmd.Flags().StringVar(&specifiedSettings.Kubernetes.ContainerEngine, "container-engine", "", "Set engine to containerd or moby (aka docker).")
	setCmd.Flags().BoolVar(&specifiedSettings.Kubernetes.Enabled, "kubernetes-enabled", false, "Control whether kubernetes runs in the backend.")
	setCmd.Flags().StringVar(&specifiedSettings.Kubernetes.Version, "kubernetes-version", "", "Choose which version of kubernetes to run.")
}

/**
 * Get the current settings as a JSON string,
 * and unmarshal the string into a settings block that we care about.
 * The update only the fields in that block which are specified on the command-line.
 * Send that block back to the server in a PUT set command.
 */
func doSetCommand() error {
  result, err := doRequest("GET", "list-settings")
  if err != nil {
    return err
  }
  var currentSettings serverSettings
  err = json.Unmarshal(result, &currentSettings)
  if err != nil {
    return err
  }

  numSpecifiedValues := 0
	for i := 2; i < len(os.Args); i++ {
		if strings.HasPrefix(os.Args[i], "--container-engine") {
      currentSettings.Kubernetes.ContainerEngine = specifiedSettings.Kubernetes.ContainerEngine
      numSpecifiedValues  += 1
		} else if strings.HasPrefix(os.Args[i], "--kubernetes-enabled") {
      currentSettings.Kubernetes.Enabled = specifiedSettings.Kubernetes.Enabled
      numSpecifiedValues  += 1
		} else if strings.HasPrefix(os.Args[i], "--kubernetes-version") {
      currentSettings.Kubernetes.Version = specifiedSettings.Kubernetes.Version
      numSpecifiedValues  += 1
		}
	}
	if numSpecifiedValues == 0 {
		return fmt.Errorf("set command: nothing specified to update")
	}
  jsonBuffer, err := json.Marshal(currentSettings)
  if err != nil {
    return err
  }
	result, err = doRequestWithPayload("PUT", "set", bytes.NewBuffer(jsonBuffer))
  if len(result) > 0 {
    fmt.Println(string(result))
  }
  return err
}
