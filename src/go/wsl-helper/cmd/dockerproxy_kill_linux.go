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
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	// Pull in to register the mungers
	_ "github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/mungers"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/process"
)

var dockerproxyKillViper = viper.New()

// dockerproxyKillCmd is the `wsl-helper docker-proxy kill` command.
var dockerproxyKillCmd = &cobra.Command{
	Use:   "kill",
	Short: "Force stop any instances of the docker socket proxy server",
	RunE: func(cmd *cobra.Command, args []string) error {
		err := process.KillOthers("docker-proxy", "serve")
		if err != nil {
			return err
		}
		return nil
	},
}

func init() {
	dockerproxyKillViper.AutomaticEnv()
	if err := dockerproxyKillViper.BindPFlags(dockerproxyKillCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	dockerproxyCmd.AddCommand(dockerproxyKillCmd)
}
