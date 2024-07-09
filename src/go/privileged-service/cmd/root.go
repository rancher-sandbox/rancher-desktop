//go:build windows

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
	"os"

	"github.com/spf13/cobra"
	"golang.org/x/sys/windows/svc"

	rancherDesktopSvc "github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/svc"
)

const svcName = "RancherDesktopPrivilegedService"
const displayName = "Rancher Desktop Privileged Service"
const svcDesc = "Privileged process management service for Rancher Desktop"

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "privileged-service",
	Short: "Rancher Desktop Privileged Service is a service that runs on Windows host",
	Long: `Rancher Desktop Privileged Service is a helper process that performs actions
	requiring extended privileges on behalf of Rancher Desktop.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		inService, err := svc.IsWindowsService()
		if err != nil {
			return err
		}
		if inService {
			return rancherDesktopSvc.RunService(svcName, false)
		}
		return nil
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}
