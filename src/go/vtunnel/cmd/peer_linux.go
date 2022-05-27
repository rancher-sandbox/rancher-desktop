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
	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/vmsock"
)

const localhost = "127.0.0.1"

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
		handshakePort, err := cmd.Flags().GetInt("handshake-port")
		if err != nil {
			return err
		}
		vsockHostPort, err := cmd.Flags().GetInt("host-port")
		if err != nil {
			return err
		}
		peerConnector := vmsock.PeerConnector{
			IPv4ListenAddress:  listenAddr,
			TCPListenPort:      port,
			VsockHandshakePort: uint32(handshakePort),
			VsockHostPort:      uint32(vsockHostPort),
		}
		go peerConnector.ListendAndHandshake()

		return peerConnector.ListenTCP()
	},
}

func init() {
	peerCmd.Flags().StringP("listen-address", "a", localhost, "IPv4 Address to listen on")
	peerCmd.Flags().IntP("tcp-port", "t", 0, "TCP port to listen on")
	peerCmd.Flags().IntP("handshake-port", "p", 0, "AF_VSOCK port for the peer to listen for handshake requests from the host")
	peerCmd.Flags().IntP("host-port", "v", 0, "AF_VSOCK port for the peer to connect to the host")
	peerCmd.MarkFlagRequired("tcp-port")
	peerCmd.MarkFlagRequired("handshake-port")
	peerCmd.MarkFlagRequired("host-port")
	rootCmd.AddCommand(peerCmd)
}
