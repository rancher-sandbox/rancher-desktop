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
	"fmt"

	"github.com/rancher-sandbox/rancher-desktop/src/go/vtunnel/pkg/vmsock"
	"github.com/spf13/cobra"
)

// hostCmd represents the host command
var hostCmd = &cobra.Command{
	Use:   "host",
	Short: "vtunnel host process",
	Long: `vtunnel host process runs on the host machine and binds to localhost
and a given port acting as a host end of the tunnel.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("host called")
		dialAddr, err := cmd.Flags().GetString("dial-address")
		if err != nil {
			return err
		}
		return vmsock.ListenAndDial(dialAddr)
	},
}

func init() {
	hostCmd.Flags().StringP("dial-address", "a", "", `TCP address of a server that host process dials into to
pipe the packets. The address format is IP:PORT.`)
	hostCmd.MarkFlagRequired("dial-address")
	rootCmd.AddCommand(hostCmd)
}
