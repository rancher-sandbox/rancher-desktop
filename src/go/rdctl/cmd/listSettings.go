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
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/reg"
	"github.com/spf13/cobra"
	"strings"
)

var outputSettings string
var outputSettingsFlags struct {
	Format              string
	RegistryHive        string
	RegistryProfileType string
}

const jsonFormat = "json"
const regFormat = "reg"
const defaultsRegistrySection = "defaults"
const lockedRegistrySection = "locked"

// listSettingsCmd represents the listSettings command
var listSettingsCmd = &cobra.Command{
	Use:   "list-settings",
	Short: "Lists the current settings.",
	Long: `Lists the current settings in JSON or Windows registry-file format.
The default output format is JSON.

To convert the current settings into a registry file, run the following command:

rdctl list-commands --output reg,X,Y

where X is either "hkcu" or "hklm", depending on whether you want to update HKEY_LOCAL_MACHINE
or HKEY_CURRENT_USER respectively,
and Y is either "defaults" or "locked", depending on which deployment profile you want to populate.
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := cobra.NoArgs(cmd, args); err != nil {
			return err
		}
		cmd.SilenceUsage = true
		result, err := getListSettings()
		if err != nil {
			return err
		}
		fmt.Println(string(result))
		return nil
	},
}

// the reg file format is directly usable only on Windows,
// but it can be created on any platform for purposes of testing or development

func init() {
	rootCmd.AddCommand(listSettingsCmd)
	listSettingsCmd.Flags().StringVarP(&outputSettings, "output", "", "", fmt.Sprintf("output format: %s|%s[,hive][,type], default %s", jsonFormat, regFormat, jsonFormat))
}

func calcOutputFormatFlags() error {
	if outputSettings == "" || outputSettings == jsonFormat {
		outputSettingsFlags.Format = jsonFormat
		return nil
	}
	parts := strings.Split(outputSettings, ",")
	if parts[0] == jsonFormat {
		if len(parts) > 1 {
			return fmt.Errorf(`the json output format takes no sub-formats, got "%s"`, outputSettings)
		}
		outputSettingsFlags.Format = jsonFormat
		return nil
	}
	if parts[0] != regFormat {
		return fmt.Errorf(`expecting an output format of '%s' or '%s', got "%s"`, jsonFormat, regFormat, outputSettings)
	}
	outputSettingsFlags.Format = regFormat
	for _, part := range parts[1:] {
		switch part {
		case reg.HklmRegistryHive:
			if outputSettingsFlags.RegistryHive != "" {
				return fmt.Errorf(`already specified registry hive "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryHive, outputSettings)
			}
			outputSettingsFlags.RegistryHive = part
			break

		case reg.HkcuRegistryHive:
			if outputSettingsFlags.RegistryHive != "" {
				return fmt.Errorf(`already specified registry hive "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryHive, outputSettings)
			}
			outputSettingsFlags.RegistryHive = part
			break

		case defaultsRegistrySection:
			if outputSettingsFlags.RegistryProfileType != "" {
				return fmt.Errorf(`already specified registry section "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryProfileType, outputSettings)
			}
			outputSettingsFlags.RegistryProfileType = part
			break

		case lockedRegistrySection:
			if outputSettingsFlags.RegistryProfileType != "" {
				return fmt.Errorf(`already specified registry section "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryProfileType, outputSettings)
			}
			outputSettingsFlags.RegistryProfileType = part
			break

		default:
			return fmt.Errorf(`expecting a reg output-format parameter, got "%s" in "%s"`, part, outputSettings)
		}
	}
	if outputSettingsFlags.RegistryHive == "" {
		outputSettingsFlags.RegistryHive = reg.HklmRegistryHive
	}
	if outputSettingsFlags.RegistryProfileType == "" {
		outputSettingsFlags.RegistryProfileType = defaultsRegistrySection
	}
	return nil
}

func getListSettings() ([]byte, error) {
	err := calcOutputFormatFlags()
	if err != nil {
		return nil, err
	}
	output, err := processRequestForUtility(doRequest("GET", versionCommand("", "settings")))
	if err != nil {
		return nil, err
	} else if outputSettingsFlags.Format == jsonFormat {
		return output, nil
	} else if outputSettingsFlags.Format == regFormat {
		lines, err := reg.JsonToReg(outputSettingsFlags.RegistryHive, outputSettingsFlags.RegistryProfileType, string(output))
		if err != nil {
			return nil, err
		}
		return []byte(strings.Join(lines, "\n")), nil
	} else {
		// This shouldn't happen
		return nil, fmt.Errorf("internal error: unexpected output format of %s", outputSettingsFlags.Format)
	}
}
