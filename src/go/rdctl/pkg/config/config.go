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
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/spf13/cobra"
)

// The CLIConfig struct is used to store the json data read from the config file.
type CLIConfig struct {
	User     string
	Password string
	Port     int
}

// ConnectionInfo stores the parameters needed to connect to the main process.
type ConnectionInfo struct {
	User     string
	Password string
	Host     string
	Port     int
}

var (
	connectionInfoFlags ConnectionInfo

	configPath string
	// defaultConfigPath - used to differentiate not being able to find a user-specified config file from the default
	defaultConfigPath string
)

// This could have a better name: ErrConfigFileNotFound. It is
// more descriptive of the situation in which we return it.
var ErrMainProcessNotRunning = errors.New("main process not running")

// DefineGlobalFlags sets up the global flags, available for all sub-commands
func DefineGlobalFlags(rootCmd *cobra.Command) {
	var configDir string
	var err error
	if runtime.GOOS == "linux" && isWSLDistro() {
		if configDir, err = wslifyConfigDir(); err != nil {
			log.Fatalf("Can't get WSL config-dir: %v", err)
		}
		configDir = filepath.Join(configDir, "rancher-desktop")
	} else {
		appPaths, err := paths.GetPaths()
		if err != nil {
			log.Fatalf("failed to get paths: %s", err)
		}
		configDir = appPaths.AppHome
	}
	defaultConfigPath = filepath.Join(configDir, "rd-engine.json")
	rootCmd.PersistentFlags().StringVar(&configPath, "config-path", "", fmt.Sprintf("config file (default %s)", defaultConfigPath))
	rootCmd.PersistentFlags().StringVar(&connectionInfoFlags.User, "user", "", "overrides the user setting in the config file")
	rootCmd.PersistentFlags().StringVar(&connectionInfoFlags.Host, "host", "", "default is 127.0.0.1; most useful for WSL")
	rootCmd.PersistentFlags().IntVar(&connectionInfoFlags.Port, "port", 0, "overrides the port setting in the config file")
	rootCmd.PersistentFlags().StringVar(&connectionInfoFlags.Password, "password", "", "overrides the password setting in the config file")
}

func PrototypeGetConnectionInfo() (*ConnectionInfo, error) {
	if userSpecifiedConnectionInfo() {
		return getCustomConnectionInfo()
	}
	return getDefaultConnectionInfo()
}

func userSpecifiedConnectionInfo() bool {
	return configPath != defaultConfigPath ||
		connectionInfoFlags.Host != "" ||
		connectionInfoFlags.Port != 0 ||
		connectionInfoFlags.User != "" ||
		connectionInfoFlags.Password != ""
}

func getCustomConnectionInfo() (*ConnectionInfo, error) {
	connectionInfo := &ConnectionInfo{
		Host: "127.0.0.1",
	}
	if content, err := os.ReadFile(configPath); err != nil {
		if configPath != defaultConfigPath {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
	} else {
		if err := json.Unmarshal(content, connectionInfo); err != nil {
			if configPath != defaultConfigPath {
				return nil, fmt.Errorf("failed to parse config file: %w", err)
			}
		}
	}

	// Overwrite connectionInfo values with values from CLI flags if present
	if connectionInfoFlags.Host != "" {
		connectionInfo.Host = connectionInfoFlags.Host
	}
	if connectionInfoFlags.Port != 0 {
		connectionInfo.Port = connectionInfoFlags.Port
	}
	if connectionInfoFlags.User != "" {
		connectionInfo.User = connectionInfoFlags.User
	}
	if connectionInfoFlags.Password != "" {
		connectionInfo.Password = connectionInfoFlags.Password
	}

	if err := validateConnectionInfo(connectionInfo); err != nil {
		return nil, fmt.Errorf("invalid connectionInfo: %w", err)
	}
	return connectionInfo, nil
}

func getDefaultConnectionInfo() (*ConnectionInfo, error) {
	connectionInfo := &ConnectionInfo{
		Host: "127.0.0.1",
	}
	content, err := os.ReadFile(configPath)
	if errors.Is(err, os.ErrNotExist) {

	}
	if err != nil {
		return nil, fmt.Errorf("%w: read default config file: %w", ErrMainProcessNotRunning, err)
	}
	if err := json.Unmarshal(content, connectionInfo); err != nil {
		return nil, fmt.Errorf("%w: unmarshal default config file: %w", ErrMainProcessNotRunning, err)
	}
	return connectionInfo, nil
}

// GetConnectionInfo gathers config from multiple sources and returns
// it as one *ConnectionInfo.
//
// If the user has specified a non-default path to the config
// file, that path must exist and be successfully parsed. Also,
// GetConnectionInfo must be able to create a valid *ConnectionInfo.
// If any of these conditions are not satisfied, an error is returned.
//
// If the user has not specified a non-default path to the config
// file, and GetConnectionInfo cannot create a valid *ConnectionInfo,
// it assumes the main process is not running and returns
// ErrMainProcessNotRunning.
func GetConnectionInfo() (*ConnectionInfo, error) {
	// Create default *ConnectionInfo
	connectionInfo := &ConnectionInfo{
		Host: "127.0.0.1",
	}

	// Overwrite connectionInfo values with values from config file, if present.
	if configPath == "" {
		configPath = defaultConfigPath
	}
	content, err := os.ReadFile(configPath)
	if err != nil {
		if configPath != defaultConfigPath {
			return nil, fmt.Errorf("failed to read config file %q: %w", configPath, err)
		}
	} else {
		if err := json.Unmarshal(content, connectionInfo); err != nil {
			if configPath != defaultConfigPath {
				return nil, fmt.Errorf("failed to unmarshal config file %q: %w", configPath, err)
			}
		}
	}
	var configFileSettings CLIConfig
	err = json.Unmarshal(content, &configFileSettings)
	if err != nil {
		if configPath != defaultConfigPath {
			return nil, fmt.Errorf("failed to unmarshal config file %q: %w", configPath, err)
		}
	} else {
		if configFileSettings.Port != 0 {
			connectionInfo.Port = configFileSettings.Port
		}
		if configFileSettings.User != "" {
			connectionInfo.User = configFileSettings.User
		}
		if configFileSettings.Password != "" {
			connectionInfo.Password = configFileSettings.Password
		}
	}

	// Overwrite connectionInfo values with values from CLI flags, if present.
	if connectionInfoFlags.Host != "" {
		connectionInfo.Host = connectionInfoFlags.Host
	}
	if connectionInfoFlags.Port != 0 {
		connectionInfo.Port = connectionInfoFlags.Port
	}
	if connectionInfoFlags.User != "" {
		connectionInfo.User = connectionInfoFlags.User
	}
	if connectionInfoFlags.Password != "" {
		connectionInfo.Password = connectionInfoFlags.Password
	}

	if err := validateConnectionInfo(connectionInfo); err != nil {
		if configPath == defaultConfigPath {
			return nil, ErrMainProcessNotRunning
		} else {
			return nil, fmt.Errorf("invalid connection info: %w", err)
		}
	}

	return connectionInfo, nil
}

func validateConnectionInfo(connectionInfo *ConnectionInfo) error {
	errs := []error{}
	if connectionInfo.Host == "" {
		errs = append(errs, fmt.Errorf("invalid host %q", connectionInfo.Host))
	}
	if connectionInfo.Port == 0 {
		errs = append(errs, fmt.Errorf("invalid port %q", connectionInfo.Port))
	}
	if connectionInfo.User == "" {
		errs = append(errs, fmt.Errorf("invalid user %q", connectionInfo.User))
	}
	if connectionInfo.Password == "" {
		errs = append(errs, fmt.Errorf("invalid password %q", connectionInfo.Password))
	}
	return errors.Join(errs...)
}

// determines if we are running in a wsl linux distro
// by checking for availability of wslpath and see if it's a symlink
func isWSLDistro() bool {
	fi, err := os.Lstat("/bin/wslpath")
	if os.IsNotExist(err) {
		return false
	}
	return fi.Mode()&os.ModeSymlink == os.ModeSymlink
}

func getLocalAppDataPath() (string, error) {
	var outBuf bytes.Buffer
	// changes the codepage to 65001 which is UTF-8
	subCommand := `chcp 65001 >nul & echo %LOCALAPPDATA%`
	cmd := exec.Command("cmd.exe", "/c", subCommand)
	cmd.Stdout = &outBuf
	// We are intentionally not using CombinedOutput and
	// excluding the stderr since it could contain some
	// warnings when rdctl is triggered from a non WSL mounted directory
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimRight(outBuf.String(), "\r\n"), nil
}

func wslifyConfigDir() (string, error) {
	path, err := getLocalAppDataPath()
	if err != nil {
		return "", err
	}
	var outBuf bytes.Buffer
	cmd := exec.Command("/bin/wslpath", path)
	cmd.Stdout = &outBuf
	if err = cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimRight(outBuf.String(), "\r\n"), err
}
