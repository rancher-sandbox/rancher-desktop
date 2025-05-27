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
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/process"
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
		proxyEndpoint := dockerproxyServeViper.GetString("proxy-endpoint")
		err := process.KillOthers("docker-proxy", "serve")
		if err != nil {
			return err
		}
		dialer, err := platform.MakeDialer(proxyEndpoint)
		if err != nil {
			return err
		}
		err = dockerproxy.Serve(endpoint, dialer)
		if err != nil {
			return err
		}
		return nil
	},
}

func init() {
	defaultProxyEndpoint, err := dockerproxy.GetDefaultProxyEndpoint()
	if err != nil {
		logrus.Fatalf("could not initialize options: %s", err)
	}
	dockerproxyServeCmd.Flags().String("endpoint", platform.DefaultEndpoint, "Endpoint to listen on")
	dockerproxyServeCmd.Flags().String("proxy-endpoint", defaultProxyEndpoint, "Endpoint dockerd is listening on")
	dockerproxyServeViper.AutomaticEnv()
	if err := dockerproxyServeViper.BindPFlags(dockerproxyServeCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	dockerproxyCmd.AddCommand(dockerproxyServeCmd)
}
