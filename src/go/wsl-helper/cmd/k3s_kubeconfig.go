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
	"fmt"
	"os"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
)

type kubeConfig struct {
	Clusters []struct {
		Cluster struct {
			Server string
			Extras map[string]interface{} `yaml:",inline"`
		} `yaml:"cluster"`
		Name   string                 `yaml:"name"`
		Extras map[string]interface{} `yaml:",inline"`
	} `yaml:"clusters"`
	Contexts []struct {
		Name   string                 `yaml:"name"`
		Extras map[string]interface{} `yaml:",inline"`
	} `yaml:"contexts"`
	CurrentContext string `yaml:"current-context"`
	Users          []struct {
		Name   string                 `yaml:"name"`
		Extras map[string]interface{} `yaml:",inline"`
	} `yaml:"users"`
	Extras map[string]interface{} `yaml:",inline"`
}

const kubeConfigExistTimeout = 10 * time.Second

var k3sKubeconfigViper = viper.New()

// k3sKubeconfigCmd represents the `k3s kubeconfig` command.
var k3sKubeconfigCmd = &cobra.Command{
	Use:   "kubeconfig",
	Short: "Fetch kubeconfig from the WSL VM",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Read the existing kubeconfig.  Wait up to 10 seconds for it to exist.
		ch := make(chan *os.File)
		abort := false
		go func() {
			configPath := k3sKubeconfigViper.GetString("k3sconfig")
			for {
				if abort {
					return
				}
				f, err := os.Open(configPath)
				if err == nil {
					ch <- f
					return
				}
				time.Sleep(time.Second)
			}
		}()
		var err error
		timeout := time.After(kubeConfigExistTimeout)
		var configFile *os.File
		select {
		case <-timeout:
			return fmt.Errorf("timed out waiting for k3s kubeconfig to exist")
		case configFile = <-ch:
			break
		}

		var config kubeConfig
		defer configFile.Close()
		err = yaml.NewDecoder(configFile).Decode(&config)
		if err != nil {
			return err
		}

		// vm-switch in rdNetworking binds to localhost:Port by default.
		// Since k3s.yaml comes with servers preset at 127.0.0.1, there
		// is nothing for us to do here, just write the config and return.
		return yaml.NewEncoder(os.Stdout).Encode(config)
	},
}

func init() {
	k3sKubeconfigCmd.Flags().String("k3sconfig", "/etc/rancher/k3s/k3s.yaml", "Path to k3s kubeconfig")
	k3sKubeconfigViper.AutomaticEnv()
	if err := k3sKubeconfigViper.BindPFlags(k3sKubeconfigCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
	k3sCmd.AddCommand(k3sKubeconfigCmd)
}
