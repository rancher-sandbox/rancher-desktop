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
	"bytes"
	"fmt"
	"github.com/spf13/cobra"
	"io/ioutil"
	"os"
	"regexp"
)

var apiSettings struct {
	Method    string
	InputFile string
	Body      string
}

// apiCmd represents the api command
var apiCmd = &cobra.Command{
	Use:   "api",
	Short: "Run API endpoints directly",
	Long: `Runs API endpoints directly.
Default method is PUT if a body or input file is specified, GET otherwise.

Two ways of specifying a body:
1. --input FILE: Like the existing preferences file. Does not support interpolation.

2. --body|-b string: For the 'PUT /settings' endpoint this must be a valid JSON string.
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return doApiCommand(cmd, args)
	},
}

func init() {
	rootCmd.AddCommand(apiCmd)
	apiCmd.Flags().StringVarP(&apiSettings.Method, "method", "X", "", "Method to use")
	apiCmd.Flags().StringVarP(&apiSettings.InputFile, "input", "", "", "File containing JSON payload to upload (- for standard input)")
	apiCmd.Flags().StringVarP(&apiSettings.Body, "body", "b", "", "JSON payload to upload")
}

func doApiCommand(cmd *cobra.Command, args []string) error {
	var result []byte
	var contents []byte
	var err error

	if len(args) == 0 {
		return fmt.Errorf("api command: no endpoint specified")
	}
	if len(args) > 1 {
		return fmt.Errorf("api command: too many endpoints specified (%v); exactly one must be specified", args)
	}
	endpoint := args[0]
	if regexp.MustCompile(`^/v\d+/`).FindString(endpoint) == "" {
		endpoint = fmt.Sprintf("/%s", versionCommand(apiVersion, endpoint))
	}
	// No longer emit usage info on errors
	cmd.SetUsageFunc(func(*cobra.Command) error { return nil })
	if apiSettings.InputFile != "" {
		if apiSettings.Method == "" {
			apiSettings.Method = "PUT"
		}
		if apiSettings.InputFile == "-" {
			contents, err = ioutil.ReadAll(os.Stdin)
		} else {
			contents, err = ioutil.ReadFile(apiSettings.InputFile)
		}
		if err != nil {
			return err
		}
		result, err = doRequestWithPayload(apiSettings.Method, endpoint, bytes.NewBuffer(contents))
	} else if apiSettings.Body != "" {
		if apiSettings.Method == "" {
			apiSettings.Method = "PUT"
		}
		result, err = doRequestWithPayload(apiSettings.Method, endpoint, bytes.NewBufferString(apiSettings.Body))
	} else {
		if apiSettings.Method == "" {
			apiSettings.Method = "GET"
		}
		result, err = doRequest(apiSettings.Method, endpoint)
	}
	if err != nil {
		return err
	}
	if len(result) > 0 {
		fmt.Println(string(result))
	}
	return nil
}
