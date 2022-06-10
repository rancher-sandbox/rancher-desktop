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
	"bufio"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"

	dockerconfig "github.com/docker/docker/cli/config"
	"github.com/spf13/cobra"
)

type dockerConfigType map[string]interface{}

var configFile string

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "docker-credential-none",
	Short: "Store docker creds in .docker/config.json.shadow",
	Long:  `Store docker credentials base64-encoded in .docker/config.json.shadow. This is mostly for testing purposes.`,
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
	configFile = filepath.Join(dockerconfig.Dir(), "config.json.shadow")
}

func getParsedConfig() (dockerConfigType, error) {
	jsonThing := make(dockerConfigType)
	contents, err := ioutil.ReadFile(configFile)
	if err != nil {
		return jsonThing, err
	}
	err = json.Unmarshal(contents, &jsonThing)
	return jsonThing, err
}

func getStandardInput() string {
	var chunks []string
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		chunks = append(chunks, scanner.Text())
	}
	return strings.TrimRight(strings.Join(chunks, ""), "\n")
}

func saveParsedConfig(config *dockerConfigType) error {
	contents, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	err = ioutil.WriteFile(configFile, contents, 0600)
	return nil
}

func jsonPacket(urlArg, username, secret string) string {
	// JSON-encode the individual parts, but use sprintf to lay it out the way other cred-helpers do.
	b1, err := json.Marshal(urlArg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		return ""
	}
	b2, err := json.Marshal(username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		return ""
	}
	b3, err := json.Marshal(secret)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		return ""
	}
	return fmt.Sprintf(`{"ServerURL": %s, "Username": %s, "Secret": %s}`, string(b1), string(b2), string(b3))
}
