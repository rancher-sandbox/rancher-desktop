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

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "vtunnel",
	Short: "A TCP Tunnel over AF_VSOCK",
	Long: `vtunnel is a network communication tunnel that bridges the host and the WSL VM
communications over TCP. The tunnel's peer process listens on a provided IP:HOST inside the WSL VM.
The host process on windows forwards the TCP payload to a given address over TCP.`,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	writer := logrus.New().Writer()
	defer writer.Close()
	rootCmd.SetErr(writer)
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}
