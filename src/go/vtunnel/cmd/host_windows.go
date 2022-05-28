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

// hostCmd represents the host command
var hostCmd = &cobra.Command{
	Use:   "host",
	Short: "vtunnel host process",
	Long: `vtunnel host process runs on the host machine and binds to localhost
and a given port acting as a host end of the tunnel.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		dialAddr, err := cmd.Flags().GetString("upstream-address")
		if err != nil {
			return err
		}
		handshakePort, err := cmd.Flags().GetInt("handshake-port")
		if err != nil {
			return err
		}
		hostPort, err := cmd.Flags().GetInt("vsock-port")
		if err != nil {
			return err
		}
		hostConnector := vmsock.HostConnector{
			UpstreamServerAddress: dialAddr,
			VsockListenPort:       uint32(hostPort),
			PeerHandshakePort:     uint32(handshakePort),
		}
		return hostConnector.ListenAndDial()
	},
}

func init() {
	hostCmd.Flags().String("upstream-address", "", `TCP address of an upstream server that host process dials into to
pipe the packets. The address format is <IP>:<PORT>`)
	hostCmd.Flags().Int("handshake-port", 0, "AF_VSOCK port for the peer handshake server")
	hostCmd.Flags().Int("vsock-port", 0, "AF_VSOCK port for the host process to listen for incoming vsock requests from peer")
	hostCmd.MarkFlagRequired("upstream-address")
	hostCmd.MarkFlagRequired("handshake-port")
	hostCmd.MarkFlagRequired("vsock-port")
	rootCmd.AddCommand(hostCmd)
}
