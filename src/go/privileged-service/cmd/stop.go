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
	"github.com/spf13/cobra"
	"golang.org/x/sys/windows/svc"

	supervisorSvc "github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/svc"
)

// stopCmd represents the stop command
var stopCmd = &cobra.Command{
	Use:   "stop",
	Short: "stops the Rancher Desktop Privileged Service",
	RunE: func(cmd *cobra.Command, args []string) error {
		return supervisorSvc.ControlService(svcName, svc.Stop, svc.Stopped)
	},
}

func init() {
	rootCmd.AddCommand(stopCmd)
}
