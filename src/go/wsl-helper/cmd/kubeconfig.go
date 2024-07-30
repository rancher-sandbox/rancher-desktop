//go:build linux

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
	"os"
	"path"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
	"k8s.io/client-go/util/homedir"
)

var kubeconfigViper = viper.New()

const rdCluster = "rancher-desktop"

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
		cmd.SilenceUsage = true

		configPath := kubeconfigViper.GetString("kubeconfig")
		enable := kubeconfigViper.GetBool("enable")
		verify := kubeconfigViper.GetBool("verify")

		configDir := path.Join(homedir.HomeDir(), ".kube")
		linkPath := path.Join(configDir, "config")
		unsupportedConfig, symlinkErr := requireManualSymlink(linkPath)
		if verify {
			if unsupportedConfig {
				logrus.Fatalf("kubeConfig: %s contains non-rancher desktop configuration", linkPath)
			}
			logrus.Infof("Verified kubeConfig: %s, it only contains Rancher Desktop configuration", linkPath)
			os.Exit(0)
		}

		if configPath == "" {
			return errors.New("Windows kubeconfig not supplied")
		}

		_, err := os.Stat(configPath)
		if err != nil {
			return fmt.Errorf("could not open Windows kubeconfig: %w", err)
		}

		if !unsupportedConfig && symlinkErr != nil {
			return symlinkErr
		}

		if enable {
			if unsupportedConfig {
				// Config contains non-Rancher Desktop configuration
				return symlinkErr
			}
			err = os.Mkdir(configDir, 0o750)
			if err != nil && !errors.Is(err, os.ErrExist) {
				// The error already contains the full path, we can't do better.
				return err
			}
			err = os.Symlink(configPath, linkPath)
			if err != nil {
				if errors.Is(err, os.ErrExist) {
					// If it already exists, do nothing; even if it's not a symlink.
					return nil
				}
				return err
			}
		} else {
			// No need to create if we want to remove it
			target, err := os.Readlink(linkPath)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					return nil
				}
				return err
			}
			if target == configPath {
				if err = removeConfig(linkPath); err != nil {
					return err
				}
			}
		}
		return nil
	},
}

// requireManualSymlink checks the config to determine if it contains a single entry for Contexts, Clusters, and Users.
// If all three are named 'rancher-desktop', we assume that this configuration was written by Rancher Desktop 1.12,
// and we can remove it and replace it with a symlink. If a user's config contains Rancher Desktop's specific configuration
// along with user-provided config, or if it only contains user-provided config, we return a true and an error.
// This indicates through diagnostics to the user that manual action is required.
func requireManualSymlink(linkPath string) (bool, error) {
	// Check to see if config is rancher desktop only
	if existingConfig, err := readKubeConfig(linkPath); err == nil {
		if len(existingConfig.Contexts) == 1 && existingConfig.Contexts[0].Name == rdCluster &&
			len(existingConfig.Clusters) == 1 && existingConfig.Clusters[0].Name == rdCluster &&
			len(existingConfig.Users) == 1 && existingConfig.Users[0].Name == rdCluster {
			if err := removeConfig(linkPath); err != nil {
				return false, err
			}
		} else {
			return true, fmt.Errorf("not overwriting kubeconfig file %s with non-Rancher Desktop contents", linkPath)
		}
	}

	return false, nil
}

func removeConfig(configPath string) error {
	err := os.Remove(configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func readKubeConfig(configPath string) (kubeConfig, error) {
	var config kubeConfig
	configFile, err := os.Open(configPath)
	if err != nil {
		return config, fmt.Errorf("could not open kubeconfig file %s: %w", configPath, err)
	}
	defer configFile.Close()
	err = yaml.NewDecoder(configFile).Decode(&config)
	if err != nil {
		return config, fmt.Errorf("could not read kubeconfig %s: %w", configPath, err)
	}

	return config, nil
}

func init() {
	kubeconfigCmd.PersistentFlags().Bool("verify", false, "Checks whether the symlinked config contains non-Rancher Desktop configuration.")
	kubeconfigCmd.PersistentFlags().Bool("enable", true, "Set up config file")
	kubeconfigCmd.PersistentFlags().String("kubeconfig", "", "Path to Windows kubeconfig, in /mnt/... form.")
	kubeconfigViper.AutomaticEnv()
	if err := kubeconfigViper.BindPFlags(kubeconfigCmd.PersistentFlags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	rootCmd.AddCommand(kubeconfigCmd)
}
