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

// Package cmd is the main package for this CLI
package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

type APIError struct {
	Message          *string `json:"message,omitifempty"`
	DocumentationUrl *string `json:"documentation_url,omitifempty"`
}

var (
	// Used for flags and config
	configDir           string
	configPath          string
	defaultConfigPath   string
	user                string
	host                string
	port                string
	password            string
	deferredConfigError error
)

const clientVersion = "1.1.0"
const apiVersion = "v0"

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "rdctl",
	Short: "A CLI for Rancher Desktop",
	Long:  `The eventual goal of this CLI is to enable any UI-based operation to be done from the command-line as well.`,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}

func init() {
	var err error

	if len(os.Args) > 1 {
		mainCommand := os.Args[1]
		if mainCommand == "-h" || mainCommand == "help" || mainCommand == "--help" {
			if len(os.Args) > 2 {
				mainCommand = os.Args[2]
			}
		}
		if mainCommand == "shell" || mainCommand == "version" || mainCommand == "completion" {
			return
		}
	}
	cobra.OnInitialize(initConfig)
	configDir, err = os.UserConfigDir()
	if err != nil {
		log.Fatal("Can't get config-dir: ", err)
	}
	defaultConfigPath = filepath.Join(configDir, "rancher-desktop", "rd-engine.json")
	rootCmd.PersistentFlags().StringVar(&configPath, "config-path", "", fmt.Sprintf("config file (default %s)", defaultConfigPath))
	rootCmd.PersistentFlags().StringVar(&user, "user", "", "overrides the user setting in the config file")
	rootCmd.PersistentFlags().StringVar(&host, "host", "", "default is localhost; most useful for WSL")
	rootCmd.PersistentFlags().StringVar(&port, "port", "", "overrides the port setting in the config file")
	rootCmd.PersistentFlags().StringVar(&password, "password", "", "overrides the password setting in the config file")
}

func versionCommand(version string, command string) string {
	if version == "" {
		return fmt.Sprintf("%s/%s", apiVersion, command)
	}
	return fmt.Sprintf("%s/%s", version, command)
}

func makeURL(host string, port string, command string) string {
	if strings.HasPrefix(command, "/") {
		return fmt.Sprintf("http://%s:%s%s", host, port, command)
	}
	return fmt.Sprintf("http://%s:%s/%s", host, port, command)
}

func doRequest(method string, command string) (*http.Response, error) {
	req, err := getRequestObject(method, command)
	if err != nil {
		return nil, err
	}
	return http.DefaultClient.Do(req)
}

func doRequestWithPayload(method string, command string, payload *bytes.Buffer) (*http.Response, error) {
	if deferredConfigError != nil && insufficientConnectionInfo() {
		return nil, deferredConfigError
	}
	req, err := http.NewRequest(method, makeURL(host, port, command), payload)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(user, password)
	req.Header.Add("Content-Type", "application/json")
	req.Close = true
	return http.DefaultClient.Do(req)
}

func getRequestObject(method string, command string) (*http.Request, error) {
	if deferredConfigError != nil && insufficientConnectionInfo() {
		return nil, deferredConfigError
	}
	req, err := http.NewRequest(method, makeURL(host, port, command), nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(user, password)
	req.Header.Add("Content-Type", "text/plain")
	req.Close = true
	return req, nil
}

func insufficientConnectionInfo() bool {
	return port == "" || user == "" || password == ""
}

func processRequestForAPI(response *http.Response, err error) ([]byte, *APIError, error) {
	if err != nil {
		return nil, nil, err
	}
	errorPacket := APIError{}
	pErrorPacket := &errorPacket
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		errorPacket.Message = &response.Status
	} else {
		pErrorPacket = nil
	}
	defer response.Body.Close()

	body, err := ioutil.ReadAll(response.Body)
	if err != nil {
		if pErrorPacket != nil {
			return nil, pErrorPacket, nil
		} else {
			// Only return this error if there is nothing else to report
			return nil, nil, err
		}
	}
	return body, pErrorPacket, nil
}

func processRequestForUtility(response *http.Response, err error) ([]byte, error) {
	if err != nil {
		return nil, err
	}
	statusMessage := ""
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		switch response.StatusCode {
		case 400:
			statusMessage = response.Status
			// Prefer the error message in the body written by the command-server, not the one from the http server.
			break
		case 401:
			return nil, fmt.Errorf("user/password not accepted")
		case 500:
			return nil, fmt.Errorf("server-side problem: please consult the server logs for more information")
		default:
			return nil, fmt.Errorf("server error return-code %d: %s", response.StatusCode, response.Status)
		}
	}

	defer response.Body.Close()

	body, err := ioutil.ReadAll(response.Body)
	if err != nil {
		if statusMessage != "" {
			return nil, fmt.Errorf("server error return-code %d: %s", response.StatusCode, statusMessage)
		}
		return nil, err
	} else if statusMessage != "" {
		return nil, fmt.Errorf("%s", string(body))
	}
	return body, nil
}

// The CLIConfig struct is used to store the json data read from the config file.
type CLIConfig struct {
	User     string
	Password string
	Port     int
}

func initConfig() {
	if configPath == "" {
		configPath = defaultConfigPath
	}
	if host == "" {
		host = "localhost"
	}
	content, err := ioutil.ReadFile(configPath)
	if err != nil {
		deferredConfigError = fmt.Errorf("trying to read config file: %v", err)
		return
	}

	var settings CLIConfig
	err = json.Unmarshal(content, &settings)
	if err != nil {
		deferredConfigError = fmt.Errorf("trying to json-load file %s: %v", configPath, err)
		return
	}

	if user == "" {
		user = settings.User
	}
	if password == "" {
		password = settings.Password
	}
	if port == "" {
		port = strconv.Itoa(settings.Port)
	}
}
