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
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
	"k8s.io/client-go/util/homedir"
)

var kubeconfigViper = viper.New()

const rdCluster = "rancher-desktop"

// kubeconfigCmd represents the kubeconfig command, used to set up kubeconfig
// in WSL distributions (running on the Linux side).  Note that we must
// pass the kubeconfig path in as an environment variable to take advantage of
// the path translation capabilities of WSL2 interop.
var kubeconfigCmd = &cobra.Command{
	Use:   "kubeconfig",
	Short: "Set up ~/.kube/config in the WSL2 environment",
	Long:  `This command configures the Kubernetes configuration inside a WSL2 distribution.`,
	Args:  cobra.ExactArgs(0),
	RunE: func(cmd *cobra.Command, args []string) error {
		winConfigPath := kubeconfigViper.GetString("kubeconfig")
		linuxConfigDir := filepath.Join(homedir.HomeDir(), ".kube")
		linuxConfigPath := filepath.Join(linuxConfigDir, "config")
		enable := kubeconfigViper.GetBool("enable")

		if winConfigPath == "" {
			//lint:ignore ST1005 The capitalization is for a proper noun.
			return errors.New("Windows kubeconfig not supplied")
		}

		// Backwards compatibility: if the Linux config is a symlink to the Windows
		// kubeconfig, unlink it.  This avoids issues where we clobber the Windows
		// kubeconfig by accident.
		if _, err := os.Readlink(linuxConfigPath); err == nil {
			linuxInfo, err1 := os.Stat(linuxConfigPath)
			windowsInfo, err2 := os.Stat(winConfigPath)
			if err1 == nil && err2 == nil && os.SameFile(linuxInfo, windowsInfo) {
				if err = os.Remove(linuxConfigPath); err != nil {
					return fmt.Errorf("failed to remove kubeconfig symlink: %w", err)
				}
			}
		}

		if !enable {
			return nil
		}

		cmd.SilenceUsage = true

		winConfig, err := readKubeConfig(winConfigPath)
		if err != nil {
			return err
		}

		linuxConfig, err := readKubeConfig(linuxConfigPath)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}

		cleanConfig := removeExistingRDConfig(rdCluster, &linuxConfig)

		kubeConfig, err := updateKubeConfig(winConfig, *cleanConfig, rdNetworking)
		if err != nil {
			return fmt.Errorf("failed to construct kubeconfig: %w", err)
		}

		var finalKubeConfigFile *os.File
		if err := os.MkdirAll(linuxConfigDir, 0o750); err != nil {
			return err
		}
		finalKubeConfigFile, err = os.Create(linuxConfigPath)
		if err != nil {
			return err
		}
		defer finalKubeConfigFile.Close()
		encoder := yaml.NewEncoder(finalKubeConfigFile)
		err = encoder.Encode(kubeConfig)
		if err != nil {
			return err
		}
		return encoder.Close()
	},
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

// updateKubeConfig reads the kube config from windows side it also
// modifies the cluster's server host to an appropriate address.
// It then merges the config with an existing configuration on
// users distro and returns the merged config.
func updateKubeConfig(winConfig, linuxConfig kubeConfig, rdNetworking bool) (kubeConfig, error) {
	for clusterIdx, cluster := range winConfig.Clusters {
		// Ignore any non rancher-desktop clusters
		if winConfig.Clusters[clusterIdx].Name != rdCluster {
			continue
		}
		server, err := url.Parse(cluster.Cluster.Server)
		if err != nil {
			// Ignore any clusters with invalid servers
			continue
		}
		host := "gateway.rancher-desktop.internal"
		if !rdNetworking {
			ip, err := getClusterIP()
			if err != nil {
				return winConfig, err
			}

			host = ip.String()
		}
		if server.Port() != "" {
			host = net.JoinHostPort(host, server.Port())
		}
		server.Host = host
		winConfig.Clusters[clusterIdx].Cluster.Server = server.String()
	}
	return mergeKubeConfigs(winConfig, linuxConfig), nil
}

func removeExistingRDConfig(name string, config *kubeConfig) *kubeConfig {
	// Remove clusters with the specified name
	var filteredClusters []struct {
		Cluster struct {
			Server string
			Extras map[string]interface{} `yaml:",inline"`
		} `yaml:"cluster"`
		Name   string                 `yaml:"name"`
		Extras map[string]interface{} `yaml:",inline"`
	}
	for _, cluster := range config.Clusters {
		if cluster.Name != name {
			filteredClusters = append(filteredClusters, cluster)
		}
	}
	config.Clusters = filteredClusters

	// Remove contexts with the specified name
	var filteredContexts []struct {
		Name   string                 `yaml:"name"`
		Extras map[string]interface{} `yaml:",inline"`
	}
	for _, context := range config.Contexts {
		if context.Name != name {
			filteredContexts = append(filteredContexts, context)
		}
	}
	config.Contexts = filteredContexts

	// Remove users with the specified name
	var filteredUsers []struct {
		Name   string                 `yaml:"name"`
		Extras map[string]interface{} `yaml:",inline"`
	}
	for _, user := range config.Users {
		if user.Name != name {
			filteredUsers = append(filteredUsers, user)
		}
	}
	config.Users = filteredUsers

	return config
}

func mergeKubeConfigs(winConfig, linuxConfig kubeConfig) kubeConfig {
	for _, ctx := range winConfig.Clusters {
		if ctx.Name == rdCluster {
			linuxConfig.Clusters = append(linuxConfig.Clusters, ctx)
		}
	}
	for _, ctx := range winConfig.Contexts {
		if ctx.Name == rdCluster {
			linuxConfig.Contexts = append(linuxConfig.Contexts, ctx)
		}
	}

	for _, user := range winConfig.Users {
		if user.Name == rdCluster {
			linuxConfig.Users = append(linuxConfig.Users, user)
		}
	}

	if linuxConfig.CurrentContext == "" {
		linuxConfig.CurrentContext = rdCluster
	}
	if len(linuxConfig.Extras) == 0 {
		linuxConfig.Extras = winConfig.Extras
	}

	return linuxConfig
}

func init() {
	kubeconfigCmd.PersistentFlags().Bool("enable", true, "Set up config file")
	kubeconfigCmd.PersistentFlags().String("kubeconfig", "", "Path to Windows kubeconfig, in /mnt/... form.")
	kubeconfigCmd.Flags().BoolVar(&rdNetworking, "rd-networking", false, "Enable the experimental Rancher Desktop Networking")
	kubeconfigViper.AutomaticEnv()
	kubeconfigViper.BindPFlags(kubeconfigCmd.PersistentFlags())
	rootCmd.AddCommand(kubeconfigCmd)
}
