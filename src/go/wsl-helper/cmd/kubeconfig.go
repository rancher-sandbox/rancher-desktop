//go:build linux
// +build linux

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
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
	"k8s.io/client-go/util/homedir"
)

var (
	kubeconfigViper = viper.New()
	rdNetworking    bool
)

// kubeconfigCmd represents the kubeconfig command, used to set up a symlink on
// the Linux side to point at the Windows-side kubeconfig.  Note that we must
// pass the kubeconfig path in as an environment variable to take advantage of
// the path translation capabilities of WSL2 interop.
var kubeconfigCmd = &cobra.Command{
	Use:   "kubeconfig",
	Short: "Set up ~/.kube/config in the WSL2 environment",
	Long:  `This command configures the Kubernetes configuration inside a WSL2 distribution.`,
	Args:  cobra.ExactArgs(0),
	RunE: func(cmd *cobra.Command, args []string) error {
		configPath := kubeconfigViper.GetString("kubeconfig")
		enable := kubeconfigViper.GetBool("enable")

		if configPath == "" {
			return errors.New("Windows kubeconfig not supplied")
		}

		_, err := os.Stat(configPath)
		if err != nil {
			return fmt.Errorf("could not open Windows kubeconfig: %w", err)
		}
		cmd.SilenceUsage = true

		configDir := path.Join(homedir.HomeDir(), ".kube")

		configFile, err := os.Open(configPath)
		if err != nil {
			return err
		}

		kubeConfig, err := updateClusterIP(configFile, rdNetworking)

		var finalKubeConfigFile *os.File
		if enable {
			finalKubeConfigFile, err = os.Create(configDir)
			if err != nil {
				return err
			}
			defer finalKubeConfigFile.Close()
			err = os.Mkdir(configDir, 0o750)
			if err != nil && !errors.Is(err, os.ErrExist) {
				// The error already contains the full path, we can't do better.
				return err
			}
			err = yaml.NewEncoder(finalKubeConfigFile).Encode(kubeConfig)
			if err != nil {
				return err
			}
		} else {
			err = os.Remove(finalKubeConfigFile.Name())
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		return nil
	},
}

func init() {
	kubeconfigCmd.PersistentFlags().Bool("enable", true, "Set up config file")
	kubeconfigCmd.PersistentFlags().String("kubeconfig", "", "Path to Windows kubeconfig, in /mnt/... form.")
	kubeconfigCmd.Flags().BoolVar(&rdNetworking, "rd-networking", false, "Enable the experimental Rancher Desktop Networking")
	kubeconfigViper.AutomaticEnv()
	kubeconfigViper.BindPFlags(kubeconfigCmd.PersistentFlags())
	rootCmd.AddCommand(kubeconfigCmd)
}
