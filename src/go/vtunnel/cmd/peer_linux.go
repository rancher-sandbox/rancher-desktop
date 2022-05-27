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
	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/vmsock"
	"github.com/spf13/cobra"
)

const (
	localhost       = "127.0.0.1"
	defaultPeerPort = 9779
)

// peerCmd represents the peer command
var peerCmd = &cobra.Command{
	Use:   "peer",
	Short: "vtunnel peer process",
	Long: `vtunnel peer process runs in the WSL VM and binds to a given
IP and port acting as a peer end of the tunnel.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		listenAddr, err := cmd.Flags().GetString("listen-address")
		if err != nil {
			return err
		}
		port, err := cmd.Flags().GetInt("tcp-port")
		if err != nil {
			return err
		}
		go vmsock.PeerHandshake()

		return vmsock.ListenTCP(listenAddr, port)
	},
}

func init() {
	peerCmd.Flags().StringP("listen-address", "a", localhost, "IPv4 Address to listen on.")
	peerCmd.Flags().IntP("tcp-port", "t", defaultPeerPort, "TCP port to listen on.")
	rootCmd.AddCommand(peerCmd)
}
