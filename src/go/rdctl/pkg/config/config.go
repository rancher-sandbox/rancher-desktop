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

// Package config handles all the config-related parts of rdctl

package config

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"github.com/spf13/cobra"
)

// The CLIConfig struct is used to store the json data read from the config file.
type CLIConfig struct {
	User     string
	Password string
	Port     int
}

// ConnectionInfo stores the parameters needed to connect to an HTTP server
type ConnectionInfo struct {
	User     string
	Password string
	Host     string
	Port     string
}

var (
	connectionSettings ConnectionInfo

	configDir         string
	configPath        string
	defaultConfigPath string
)

// DefineGlobalFlags sets up the global flags, available for all sub-commands
func DefineGlobalFlags(rootCmd *cobra.Command) {
	var err error

	configDir, err = os.UserConfigDir()
	if err != nil {
		log.Fatal("Can't get config-dir: ", err)
	}
	defaultConfigPath = filepath.Join(configDir, "rancher-desktop", "rd-engine.json")
	rootCmd.PersistentFlags().StringVar(&configPath, "config-path", "", fmt.Sprintf("config file (default %s)", defaultConfigPath))
	rootCmd.PersistentFlags().StringVar(&connectionSettings.User, "user", "", "overrides the user setting in the config file")
	rootCmd.PersistentFlags().StringVar(&connectionSettings.Host, "host", "", "default is localhost; most useful for WSL")
	rootCmd.PersistentFlags().StringVar(&connectionSettings.Port, "port", "", "overrides the port setting in the config file")
	rootCmd.PersistentFlags().StringVar(&connectionSettings.Password, "password", "", "overrides the password setting in the config file")
}

// GetConnectionInfo returns the connection info if it has it, and an error message explaining why
// it isn't available if it doesn't have it.
// So if the user runs an `rdctl` command after a factory reset, there is no config file (in the default location),
// but it might not be necessary. So only use the error message for the missing file if it is actually needed.
func GetConnectionInfo() (*ConnectionInfo, error) {
	err, isImmediateError := finishConnectionSettings()
	if err != nil && (isImmediateError || insufficientConnectionInfo()) {
		return nil, err
	}
	return &connectionSettings, nil
}

func finishConnectionSettings() (error, bool) {
	if configPath == "" {
		configPath = defaultConfigPath
	}
	if connectionSettings.Host == "" {
		connectionSettings.Host = "localhost"
	}
	content, err := ioutil.ReadFile(configPath)
	if err != nil {
		// If the default config file isn't available, it might not have been created yet,
		// so don't complain if we don't need it.
		// But if the user specified their own --config-path and it's not readable, complain immediately.
		return err, configPath != defaultConfigPath
	}

	var settings CLIConfig
	err = json.Unmarshal(content, &settings)
	if err != nil {
		return fmt.Errorf("error in config file %s: %w", configPath, err), configPath != defaultConfigPath
	}

	if connectionSettings.User == "" {
		connectionSettings.User = settings.User
	}
	if connectionSettings.Password == "" {
		connectionSettings.Password = settings.Password
	}
	if connectionSettings.Port == "" {
		connectionSettings.Port = strconv.Itoa(settings.Port)
	}
	return nil, false
}

func insufficientConnectionInfo() bool {
	return connectionSettings.Port == "" || connectionSettings.User == "" || connectionSettings.Password == ""
}
