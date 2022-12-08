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
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	rdconfig "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/shutdown"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

type shutdownSettingsStruct struct {
	Verbose         bool
	WaitForShutdown bool
}

var commonShutdownSettings shutdownSettingsStruct

// shutdownCmd represents the shutdown command
var shutdownCmd = &cobra.Command{
	Use:   "shutdown",
	Short: "Shuts down the running Rancher Desktop application",
	Long:  `Shuts down the running Rancher Desktop application.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		if commonShutdownSettings.Verbose {
			logrus.SetLevel(logrus.TraceLevel)
		}
		cmd.SilenceUsage = true
		result, err := doShutdown(&commonShutdownSettings)
		if err != nil {
			return err
		}
		if result != nil {
			fmt.Println(string(result))
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(shutdownCmd)
	shutdownCmd.Flags().BoolVar(&commonShutdownSettings.Verbose, "verbose", false, "be verbose")
	shutdownCmd.Flags().BoolVar(&commonShutdownSettings.WaitForShutdown, "wait", true, "wait for shutdown to be confirmed")
}

func doShutdown(shutdownSettings *shutdownSettingsStruct) ([]byte, error) {
	output, err := processRequestForUtility(doRequest("PUT", versionCommand("", "shutdown")))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if strings.Contains(err.Error(), rdconfig.DefaultConfigPath) {
				logrus.Debugf("Can't find default config file %s, assuming Rancher Desktop isn't running.\n", rdconfig.DefaultConfigPath)
				// It's probably not running, so shutdown is a no-op
				return nil, nil
			}
			return nil, err
		}
		urlError := new(url.Error)
		if errors.As(err, &urlError) {
			return []byte("Rancher Desktop is currently not running (or can't be shutdown via this command)."), nil
		}
		return nil, err
	}
	err = shutdown.FinishShutdown(shutdownSettings.WaitForShutdown)
	return output, err
}
