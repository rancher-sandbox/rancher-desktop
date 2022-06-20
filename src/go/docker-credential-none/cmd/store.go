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
	"github.com/spf13/cobra"
)

var storeCmd = &cobra.Command{
	Use:   "store",
	Short: "Update the auths based on the JSON object written to stdin.",
	Long: `Update the auths based on the JSON object written to stdin. The input format is:
{"ServerURL":"ENDPOINT"", "Username":"USERNAME", "Secret":"PASSWORD"}`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cmd.SilenceUsage = true
		return doStore()
	},
}

func init() {
	rootCmd.AddCommand(storeCmd)
}

func doStore() error {
	var auths map[string]interface{}

	config, err := getParsedConfig()
	if err != nil {
		return err
	}
	jsonPayload := getStandardInput()
	cred := credType{}
	err = json.Unmarshal([]byte(jsonPayload), &cred)
	if err != nil {
		return err
	}
	authsInterface, ok := config["auths"]
	if ok {
		auths, ok = authsInterface.(map[string]interface{})
	}
	if !ok {
		// Either config['auths'] doesn't exist or it isn't a hash
		auths = map[string]interface{}{}
		config["auths"] = auths
	}
	d := base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("%s:%s", cred.Username, cred.Secret)))
	auths[cred.ServerURL] = map[string]string{"auth": d}
	return saveParsedConfig(&config)
}
