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

package cmd

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// getCmd represents the get command
var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get all the data associated with the URL written to stdin.",
	Long:  `Get all the data associated with the URL written to stdin.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return doGet()
	},
}

func init() {
	rootCmd.AddCommand(getCmd)
}

func doGet() error {
	urlArg := getStandardInput()
	config, err := getParsedConfig()
	if err != nil {
		return err
	}
	payload := doGetAux(&config, urlArg)
	if payload == "" {
		fmt.Fprintf(os.Stdout, "credentials not found in native keychain")
	} else {
		fmt.Fprintln(os.Stdout, payload)
	}
	return nil
}

func doGetAux(config *dockerConfigType, urlArg string) string {
	authsInterface, ok := (*config)["auths"]
	if !ok {
		return ""
	}
	auths := authsInterface.(map[string]interface{})
	authDataForUrl, ok := auths[urlArg]
	if !ok {
		return ""
	}
	authData, ok := authDataForUrl.(map[string]interface{})["auth"]
	if !ok {
		return ""
	}
	credentialPair, err := base64.StdEncoding.DecodeString(authData.(string))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		return ""
	}
	parts := strings.SplitN(string(credentialPair), ":", 2)
	return jsonPacket(urlArg, parts[0], parts[1])
}
