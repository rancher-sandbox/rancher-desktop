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
	"path/filepath"

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
		winConfigPath := kubeconfigViper.GetString("kubeconfig")
		enable := kubeconfigViper.GetBool("enable")

		if winConfigPath == "" {
			return errors.New("Windows kubeconfig not supplied")
		}

		_, err := os.Stat(winConfigPath)
		if err != nil {
			return fmt.Errorf("could not open Windows kubeconfig: %w", err)
		}
		cmd.SilenceUsage = true

		winConfig, err := readKubeConfig(winConfigPath)
		if err != nil {
			return err
		}

		linuxConfigDir := path.Join(homedir.HomeDir(), ".kube")
		linuxConfig, err := readKubeConfig(filepath.Join(linuxConfigDir, "config"))
		if err != nil {
			return err
		}

		cleanConfig := removeExistingRDCluster(rdCluster, &linuxConfig)

		kubeConfig, err := updateClusterIP(winConfig, *cleanConfig, rdNetworking)

		var finalKubeConfigFile *os.File
		if enable {
			if err := os.MkdirAll(linuxConfigDir, 0o750); err != nil {
				return err
			}
			finalKubeConfigFile, err = os.Create(filepath.Join(linuxConfigDir, "config"))
			if err != nil {
				return err
			}
			defer finalKubeConfigFile.Close()
			err = os.MkdirAll(linuxConfigDir, 0o750)
			if err != nil && !errors.Is(err, os.ErrExist) {
				// The error already contains the full path, we can't do better.
				return err
			}
			err = yaml.NewEncoder(finalKubeConfigFile).Encode(kubeConfig)
			if err != nil {
				return err
			}
		}
		return nil
	},
}

func readKubeConfig(configPath string) (kubeConfig, error) {
	var config kubeConfig
	configFile, err := os.Open(configPath)
	if err != nil {
		return config, err
	}
	defer configFile.Close()
	err = yaml.NewDecoder(configFile).Decode(&config)
	if err != nil {
		return config, err
	}

	return config, nil
}

func updateClusterIP(winConfig, linuxConfig kubeConfig, rdNetworking bool) (kubeConfig, error) {
	ip, err := getClusterIP()
	if err != nil {
		return winConfig, err
	}
	// Fix up any clusters at 127.0.0.1, using the IP address we found.
	for clusterIdx, cluster := range winConfig.Clusters {
		server, err := url.Parse(cluster.Cluster.Server)
		if err != nil {
			// Ignore any clusters with invalid servers
			continue
		}
		if server.Hostname() != "127.0.0.1" {
			continue
		}
		if rdNetworking {
			server.Host = "gateway.rancher-desktop.internal:6443"
		} else {
			if server.Port() != "" {
				server.Host = net.JoinHostPort(ip.String(), server.Port())
			} else {
				server.Host = ip.String()
			}

		}
		winConfig.Clusters[clusterIdx].Name = "rancher-desktop"
		winConfig.Clusters[clusterIdx].Cluster.Server = server.String()
	}
	return mergeKubeConfigs(winConfig, linuxConfig), nil
}

func removeExistingRDCluster(clusterName string, config *kubeConfig) *kubeConfig {
	var newClusters []struct {
		Name    string `yaml:"name"`
		Cluster struct {
			Server string
			Extras map[string]interface{} `yaml:",inline"`
		}
		Extras map[string]interface{} `yaml:",inline"`
	}

	for _, cluster := range config.Clusters {
		if cluster.Name != clusterName {
			newClusters = append(newClusters, cluster)
		}
	}
	config.Clusters = newClusters
	return config
}

func mergeKubeConfigs(winConfig, linuxConfig kubeConfig) kubeConfig {
	mergedConfig := winConfig

	for _, linuxCluster := range linuxConfig.Clusters {
		// Check if a cluster with the same name already exists in the mergedConfig
		exists := false
		for _, winCluster := range mergedConfig.Clusters {
			if winCluster.Name == linuxCluster.Name {
				exists = true
				break
			}
		}

		// If the cluster doesn't exist in winConfig, add it to the mergedConfig
		if !exists {
			mergedConfig.Clusters = append(mergedConfig.Clusters, linuxCluster)
		}
	}

	return mergedConfig
}

func init() {
	kubeconfigCmd.PersistentFlags().Bool("enable", true, "Set up config file")
	kubeconfigCmd.PersistentFlags().String("kubeconfig", "", "Path to Windows kubeconfig, in /mnt/... form.")
	kubeconfigCmd.Flags().BoolVar(&rdNetworking, "rd-networking", false, "Enable the experimental Rancher Desktop Networking")
	kubeconfigViper.AutomaticEnv()
	kubeconfigViper.BindPFlags(kubeconfigCmd.PersistentFlags())
	rootCmd.AddCommand(kubeconfigCmd)
}
