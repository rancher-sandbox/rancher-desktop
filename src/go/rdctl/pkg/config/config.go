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

type ConnectionInfo struct {
	User     string
	Password string
	Host     string
	Port     string
}

var (
	connectionSettings ConnectionInfo

	configDir           string
	configPath          string
	defaultConfigPath   string
	deferredConfigError error
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
	if deferredConfigError != nil && insufficientConnectionInfo() {
		return nil, deferredConfigError
	}
	return &connectionSettings, nil
}

// InitConfig is run after all modules are loaded and before the appropriate Execute function is invoked
func InitConfig() {
	if configPath == "" {
		configPath = defaultConfigPath
	}
	if connectionSettings.Host == "" {
		connectionSettings.Host = "localhost"
	}
	content, err := ioutil.ReadFile(configPath)
	if err != nil {
		// If the default config file isn't available, it might not have been created yet, so don't complain.
		// But if the user specified their own --config-path and it's not readable, complain immediately.
		if configPath != defaultConfigPath {
			// This code does the same as `log.Fatalf` without emitting the leading timestamp.
			fmt.Fprintf(os.Stderr, "Error: trying to read config file: %v", err)
			os.Exit(1)
		}
		deferredConfigError = fmt.Errorf("trying to read config file: %v", err)
		return
	}

	var settings CLIConfig
	err = json.Unmarshal(content, &settings)
	if err != nil {
		deferredConfigError = fmt.Errorf("trying to json-load file %s: %v", configPath, err)
		return
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
}

func insufficientConnectionInfo() bool {
	return connectionSettings.Port == "" || connectionSettings.User == "" || connectionSettings.Password == ""
}
