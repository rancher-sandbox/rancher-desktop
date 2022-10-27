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
	"context"

	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"

	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/vmsock"
)

// hostCmd represents the host command
var hostCmd = &cobra.Command{
	Use:   "host",
	Short: "vtunnel host process",
	Long: `vtunnel host process runs on the host machine and binds to localhost
and a given port acting as a host end of the tunnel.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		configPath, err := cmd.Flags().GetString("config-path")
		if err != nil {
			return err
		}
		conf, err := config.NewConfig(configPath)
		if err != nil {
			return err
		}
		errs, _ := errgroup.WithContext(context.Background())
		for _, tun := range conf.Tunnel {
			hostConnector := vmsock.HostConnector{
				UpstreamServerAddress: tun.UpstreamServerAddress,
				VsockListenPort:       tun.VsockHostPort,
				PeerHandshakePort:     tun.HandshakePort,
			}
			errs.Go(hostConnector.ListenAndDial)
		}
		return errs.Wait()
	},
}

func init() {
	hostCmd.Flags().String("config-path", "", "Path to the vtunnel's yaml configuration file")
	hostCmd.MarkFlagRequired("config-path")
	rootCmd.AddCommand(hostCmd)
}
