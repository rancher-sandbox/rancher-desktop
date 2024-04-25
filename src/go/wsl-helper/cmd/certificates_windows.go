/*
Copyright © 2023 SUSE LLC

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
	"encoding/pem"
	"os"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/certificates"
)

var certificatesViper = viper.New()

// certificatesCmd represents the `certificates` command.
var certificatesCmd = &cobra.Command{
	Use:   "certificates",
	Short: "Lists the installed system certificates in PEM format",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		for _, storeName := range certificatesViper.GetStringSlice("stores") {
			ch, err := certificates.GetSystemCertificates(storeName)
			if err != nil {
				return err
			}
			for entry := range ch {
				if entry.Err != nil {
					return entry.Err
				}
				if entry.Cert == nil {
					continue
				}
				if entry.Cert.NotAfter.Before(time.Now()) {
					continue
				}
				block := &pem.Block{Type: "CERTIFICATE", Bytes: entry.Cert.Raw}
				err = pem.Encode(os.Stdout, block)
				if err != nil {
					return err
				}
			}
		}
		return nil
	},
}

func init() {
	certificatesCmd.Flags().StringSlice("stores", []string{"CA", "ROOT"}, "Certificate stores to enumerate")
	certificatesViper.AutomaticEnv()
	if err := certificatesViper.BindPFlags(certificatesCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	rootCmd.AddCommand(certificatesCmd)
}
