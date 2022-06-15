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
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
)

type APIError struct {
	Message          *string `json:"message,omitempty"`
	DocumentationUrl *string `json:"documentation_url,omitempty"`
}

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
	config.DefineGlobalFlags(rootCmd)
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
	connectionInfo, err := config.GetConnectionInfo()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, makeURL(connectionInfo.Host, connectionInfo.Port, command), payload)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(connectionInfo.User, connectionInfo.Password)
	req.Header.Add("Content-Type", "application/json")
	req.Close = true
	return http.DefaultClient.Do(req)
}

func getRequestObject(method string, command string) (*http.Request, error) {
	connectionInfo, err := config.GetConnectionInfo()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, makeURL(connectionInfo.Host, connectionInfo.Port, command), nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(connectionInfo.User, connectionInfo.Password)
	req.Header.Add("Content-Type", "text/plain")
	req.Close = true
	return req, nil
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
