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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

// ConnectionInfo stores the parameters needed to connect to an HTTP server
type ConnectionInfo struct {
	User     string
	Password string
	Host     string
	Port     int
}

var (
	connectionSettings ConnectionInfo
	verbose            bool

	configPath string
	// DefaultConfigPath - used to differentiate not being able to find a user-specified config file from the default
	DefaultConfigPath string

	wslDistroEnvs = []string{"WSL_DISTRO_NAME", "WSL_INTEROP", "WSLENV"}
	// lstatFunc allows tests to inject a stub for /bin/wslpath checks.
	lstatFunc = os.Lstat
)

// DefineGlobalFlags sets up the global flags, available for all sub-commands
func DefineGlobalFlags(rootCmd *cobra.Command) {
	var configDir string
	var err error
	if runtime.GOOS == "linux" && isWSLDistro() {
		ctx := rootCmd.Context()
		if ctx == nil {
			ctx = context.Background()
		}
		if configDir, err = wslifyConfigDir(ctx); err == nil {
			windowsConfigPath := filepath.Join(configDir, "rancher-desktop", "rd-engine.json")
			if _, statErr := os.Stat(windowsConfigPath); statErr != nil {
				configDir = ""
			} else {
				configDir = filepath.Join(configDir, "rancher-desktop")
			}
		} else {
			configDir = ""
		}
	}
	if configDir == "" {
		appPaths, err := paths.GetPaths()
		if err != nil {
			log.Fatalf("failed to get paths: %s", err)
		}
		configDir = appPaths.AppHome
	}
	DefaultConfigPath = filepath.Join(configDir, "rd-engine.json")
	rootCmd.PersistentFlags().StringVar(&configPath, "config-path", "", fmt.Sprintf("config file (default %s)", DefaultConfigPath))
	rootCmd.PersistentFlags().StringVar(&connectionSettings.User, "user", "", "overrides the user setting in the config file")
	rootCmd.PersistentFlags().StringVar(&connectionSettings.Host, "host", "", "default is 127.0.0.1; most useful for WSL")
	rootCmd.PersistentFlags().IntVar(&connectionSettings.Port, "port", 0, "overrides the port setting in the config file")
	rootCmd.PersistentFlags().StringVar(&connectionSettings.Password, "password", "", "overrides the password setting in the config file")
	rootCmd.PersistentFlags().BoolVar(&verbose, "verbose", false, "Be verbose")
}

// GetConnectionInfo returns the connection details of the application API server.
// As a special case this function may return a nil *ConnectionInfo and nil error
// when the config file has not been specified explicitly, the default config file
// does not exist, and the mayBeMissing parameter is true.
func GetConnectionInfo(mayBeMissing bool) (*ConnectionInfo, error) {
	var settings ConnectionInfo

	if configPath == "" {
		configPath = DefaultConfigPath
	}
	content, readFileError := os.ReadFile(configPath)
	if readFileError != nil {
		// It is ok if the default config path doesn't exist; the user may have specified the required settings on the commandline.
		// But it is an error if the file specified via --config-path cannot be read.
		if configPath != DefaultConfigPath || !errors.Is(readFileError, os.ErrNotExist) {
			return nil, readFileError
		}
	} else if err := json.Unmarshal(content, &settings); err != nil {
		return nil, fmt.Errorf("error parsing config file %q: %w", configPath, err)
	}

	// CLI options override file settings
	if connectionSettings.Host != "" {
		settings.Host = connectionSettings.Host
	}
	if settings.Host == "" {
		settings.Host = "127.0.0.1"
	}
	if connectionSettings.User != "" {
		settings.User = connectionSettings.User
	}
	if connectionSettings.Password != "" {
		settings.Password = connectionSettings.Password
	}
	if connectionSettings.Port != 0 {
		settings.Port = connectionSettings.Port
	}
	if settings.Port == 0 || settings.User == "" || settings.Password == "" {
		// Missing the default config file may or may not be considered an error
		if readFileError != nil {
			if mayBeMissing {
				readFileError = nil
			}
			return nil, readFileError
		}
		return nil, errors.New("insufficient connection settings (missing one or more of: port, user, and password)")
	}

	return &settings, nil
}

// determines if we are running in a wsl linux distro
// by checking for availability of wslpath and see if it's a symlink
func isWSLDistro() bool {
	fi, err := lstatFunc("/bin/wslpath")
	if err != nil {
		return false
	}
	if fi.Mode()&os.ModeSymlink != os.ModeSymlink {
		return false
	}
	return hasWSLEnvs()
}

// hasWSLEnvs reports whether any WSL environment marker is present.
func hasWSLEnvs() bool {
	for _, envName := range wslDistroEnvs {
		if _, ok := os.LookupEnv(envName); ok {
			return true
		}
	}
	return false
}

func getLocalAppDataPath(ctx context.Context) (string, error) {
	var outBuf bytes.Buffer
	// changes the codepage to 65001 which is UTF-8
	subCommand := `chcp 65001 >nul & echo %LOCALAPPDATA%`
	cmd := exec.CommandContext(ctx, "cmd.exe", "/c", subCommand)
	cmd.Stdout = &outBuf
	// We are intentionally not using CombinedOutput and
	// excluding the stderr since it could contain some
	// warnings when rdctl is triggered from a non WSL mounted directory
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimRight(outBuf.String(), "\r\n"), nil
}

func wslifyConfigDir(ctx context.Context) (string, error) {
	path, err := getLocalAppDataPath(ctx)
	if err != nil {
		return "", err
	}
	var outBuf bytes.Buffer
	cmd := exec.CommandContext(ctx, "/bin/wslpath", path)
	cmd.Stdout = &outBuf
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimRight(outBuf.String(), "\r\n"), err
}

// PersistentPreRunE is meant to be executed as the cobra hook
func PersistentPreRunE(cmd *cobra.Command, args []string) error {
	if verbose {
		logrus.SetLevel(logrus.TraceLevel)
	}
	return nil
}
