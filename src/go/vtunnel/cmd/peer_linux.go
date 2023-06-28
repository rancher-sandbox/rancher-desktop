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

// peerCmd represents the peer command
var peerCmd = &cobra.Command{
	Use:   "peer",
	Short: "vtunnel peer process",
	Long: `vtunnel peer process runs in the WSL VM and binds to a given
IP and port acting as a peer end of the tunnel.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		path, err := cmd.Flags().GetString("config-path")
		if err != nil {
			return err
		}
		conf, err := config.NewConfig(path)
		if err != nil {
			return err
		}

		errs, _ := errgroup.WithContext(context.Background())
		for _, tun := range conf.Tunnel {
			peerConnector := vmsock.PeerConnector{
				IPv4ListenAddress:  tun.PeerAddress,
				TCPListenPort:      tun.PeerPort,
				VsockHandshakePort: tun.HandshakePort,
				VsockHostPort:      tun.VsockHostPort,
			}
			go peerConnector.ListenAndHandshake()
			errs.Go(peerConnector.ListenTCP)
		}
		return errs.Wait()
	},
}

func init() {
	peerCmd.Flags().String("config-path", "", "Path to the vtunnel's yaml configuration file")
	peerCmd.MarkFlagRequired("config-path")
	rootCmd.AddCommand(peerCmd)
}
