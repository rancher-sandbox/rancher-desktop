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
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// getCmd represents the get command
var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get all the data associated with the URL written to stdin.",
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
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
	userData, err := getRecordForServerURL(&config, urlArg)
	if err != nil {
		// These errors get written to stdout, and the function exits normally.
		fmt.Println(err)
		return nil
	}
	b, err := json.Marshal(userData)
	if err != nil {
		// But a JSON-serialization error is more serious.
		return err
	}
	fmt.Printf("%s\n", string(b))
	return nil
}

/**
 * Returns the Username and Secret associated with `urlArg`, or an error if there was a problem.
 */
func getRecordForServerURL(config *dockerConfigType, urlArg string) (*credType, error) {
	authsInterface, ok := (*config)["auths"]
	if !ok {
		return nil, URLNotFoundError{}
	}
	auths := authsInterface.(map[string]interface{})
	authDataForUrl, ok := auths[urlArg]
	if !ok {
		return nil, URLNotFoundError{}
	}
	authData, ok := authDataForUrl.(map[string]interface{})["auth"]
	if !ok {
		return nil, URLNotFoundError{}
	}
	credentialPair, err := base64.StdEncoding.DecodeString(authData.(string))
	if err != nil {
		return nil, fmt.Errorf("base64-decoding authdata for URL %s: %s", urlArg, err)
	}
	parts := strings.SplitN(string(credentialPair), ":", 2)
	if len(parts) == 1 {
		return nil, fmt.Errorf("not a valid base64-encoded pair: <%s>", authData.(string))
	}
	if parts[0] == "" {
		return nil, NoUserForURLError{}
	}
	return &credType{urlArg, parts[0], parts[1]}, nil
}

// These error messages are taken from
// https://github.com/docker/docker-credential-helpers/blob/master/credentials/error.go
// to ensure consistency with error messages from other helpers

type URLNotFoundError struct {
	Err error
}

func (e URLNotFoundError) Error() string {
	return "credentials not found in native keychain"
}

type NoUserForURLError struct {
	Err error
}

func (e NoUserForURLError) Error() string {
	return "no credentials username"
}
