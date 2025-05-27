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
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/plist"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/reg"
)

const plistFormat = "plist"
const regFormat = "reg"
const defaultsType = "defaults"
const lockedType = "locked"

// The distinction between 'system' and 'user' is only needed for registry output
// because it gets written into the generated .reg data, while on macOS the distinction
// is based on which directory the generated file is placed in (and what name it's given).
const systemHive = "system"
const userHive = "user"

var outputSettingsFlags struct {
	Format              string
	RegistryHive        string // Should be USER or SYSTEM!
	RegistryProfileType string
}
var InputFile string
var JSONBody string
var UseCurrentSettings bool

// createProfileCmd represents the createProfile command
var createProfileCmd = &cobra.Command{
	Use:   "create-profile",
	Short: "Generate a deployment profile in either macOS plist or Windows registry format",
	Long: `Use this to generate deployment profiles for Rancher Desktop settings.
You can either convert the current listings in operation, or
specify a JSON snippet, and convert that to the desired target.
macOS plist files can be placed in the appropriate directory, while ".reg" files
can be imported into the Windows registry using the "eg import FILE" command.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		result, err := createProfile(cmd.Context())
		if err != nil {
			return err
		}
		fmt.Println(result)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(createProfileCmd)
	createProfileCmd.Flags().StringVar(&outputSettingsFlags.Format, "output", "", fmt.Sprintf("output format: %s|%s", plistFormat, regFormat))
	createProfileCmd.Flags().StringVar(&outputSettingsFlags.RegistryHive, "hive", "", fmt.Sprintf(`registry hive: %s|%s (default %q)`, reg.HklmRegistryHive, reg.HkcuRegistryHive, reg.HklmRegistryHive))
	createProfileCmd.Flags().StringVar(&outputSettingsFlags.RegistryProfileType, "type", "", fmt.Sprintf(`registry section: %s|%s (default %q)`, defaultsType, lockedType, defaultsType))
	createProfileCmd.Flags().StringVar(&InputFile, "input", "", "File containing a JSON document (- for standard input)")
	createProfileCmd.Flags().StringVarP(&JSONBody, "body", "b", "", "Command-line option containing a JSON document")
	createProfileCmd.Flags().BoolVar(&UseCurrentSettings, "from-settings", false, "Use current settings")
}

func createProfile(ctx context.Context) (string, error) {
	err := validateProfileFormatFlags()
	if err != nil {
		return "", err
	}
	var output []byte

	if JSONBody != "" {
		output = []byte(JSONBody)
	} else if InputFile != "" {
		if InputFile == "-" {
			output, err = io.ReadAll(os.Stdin)
		} else {
			output, err = os.ReadFile(InputFile)
		}
	} else {
		if !UseCurrentSettings {
			// This should have been caught in validateProfileFormatFlags
			return "", fmt.Errorf(`no input format specified: must specify exactly one input format of "--input FILE|-", "--body|-b STRING", or "--from-settings"`)
		}
		connectionInfo, err2 := config.GetConnectionInfo(false)
		if err2 != nil {
			return "", fmt.Errorf("failed to get connection info: %w", err2)
		}
		rdClient := client.NewRDClient(connectionInfo)
		command := client.VersionCommand("", "settings")
		output, err = client.ProcessRequestForUtility(rdClient.DoRequest(ctx, http.MethodGet, command))
	}
	if err != nil {
		return "", err
	}
	switch outputSettingsFlags.Format {
	case regFormat:
		lines, err := reg.JSONToReg(outputSettingsFlags.RegistryHive, outputSettingsFlags.RegistryProfileType, string(output))
		if err != nil {
			return "", err
		}
		return strings.Join(lines, "\n"), nil
	case plistFormat:
		return plist.JSONToPlist(string(output))
	}
	return "", fmt.Errorf(`internal error: expecting an output format of %q or %q, got %q`, regFormat, plistFormat, outputSettingsFlags.Format)
}

func validateProfileFormatFlags() error {
	if outputSettingsFlags.Format == "" {
		return fmt.Errorf(`an "--output FORMAT" option of either %q or %q must be specified`, plistFormat, regFormat)
	}
	if outputSettingsFlags.Format != plistFormat && outputSettingsFlags.Format != regFormat {
		return fmt.Errorf(`received unrecognized "--output FORMAT" option of %q; %q or %q must be specified`, outputSettingsFlags.Format, plistFormat, regFormat)
	}
	if InputFile == "" && JSONBody == "" && !UseCurrentSettings {
		return fmt.Errorf(`no input format specified: must specify exactly one input format of "--input FILE|-", "--body|-b STRING", or "--from-settings"`)
	}
	if (InputFile != "" && (JSONBody != "" || UseCurrentSettings)) || (JSONBody != "" && UseCurrentSettings) {
		return fmt.Errorf(`too many input formats specified: must specify exactly one input format of "--input FILE|-", "--body|-b STRING", or "--from-settings"`)
	}

	if outputSettingsFlags.Format == plistFormat {
		if outputSettingsFlags.RegistryHive != "" || outputSettingsFlags.RegistryProfileType != "" {
			return fmt.Errorf(`registry hive and type can't be specified with "plist"`)
		}
		return nil
	}

	switch strings.ToLower(outputSettingsFlags.RegistryHive) {
	case reg.HklmRegistryHive, reg.HkcuRegistryHive:
		outputSettingsFlags.RegistryHive = strings.ToLower(outputSettingsFlags.RegistryHive)
	case "":
		outputSettingsFlags.RegistryHive = reg.HklmRegistryHive
	default:
		return fmt.Errorf("invalid registry hive of %q specified, must be %q or %q", outputSettingsFlags.RegistryHive, systemHive, userHive)
	}
	switch strings.ToLower(outputSettingsFlags.RegistryProfileType) {
	case defaultsType, lockedType:
		outputSettingsFlags.RegistryProfileType = strings.ToLower(outputSettingsFlags.RegistryProfileType)
	case "":
		outputSettingsFlags.RegistryProfileType = defaultsType
	default:
		return fmt.Errorf("invalid registry type of %q specified, must be %q or %q", outputSettingsFlags.RegistryProfileType, defaultsType, lockedType)
	}
	return nil
}
