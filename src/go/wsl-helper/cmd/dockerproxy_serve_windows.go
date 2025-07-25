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

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy"
	// Pull in to register the mungers
	_ "github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/mungers"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/platform"
)

var dockerproxyServeViper = viper.New()

// dockerproxyServeCmd is the `wsl-helper docker-proxy serve` command.
var dockerproxyServeCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the docker socket proxy server",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		cmd.SilenceErrors = true
		endpoint := dockerproxyServeViper.GetString("endpoint")
		port := dockerproxyServeViper.GetUint32("port")
		dialer, err := platform.MakeDialer(port)
		if err != nil {
			return err
		}
		err = dockerproxy.Serve(cmd.Context(), endpoint, dialer)
		if err != nil {
			return err
		}
		return nil
	},
}

func init() {
	dockerproxyServeCmd.Flags().String("endpoint", platform.DefaultEndpoint, "Endpoint to listen on")
	dockerproxyServeCmd.Flags().Uint32("port", dockerproxy.DefaultPort, "Vsock port docker is listening on")
	dockerproxyServeViper.AutomaticEnv()
	if err := dockerproxyServeViper.BindPFlags(dockerproxyServeCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	dockerproxyCmd.AddCommand(dockerproxyServeCmd)
}
