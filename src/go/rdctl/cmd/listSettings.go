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

// listSettingsCmd represents the listSettings command
var listSettingsCmd = &cobra.Command{
	Use:   "list-settings",
	Short: "Lists the current settings.",
	Long:  `Lists the current settings in JSON format.`,
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
	listSettingsCmd.Flags().StringVarP(&outputSettings, "output", "", "", "output format: json|reg[,hive][,type], default json")
}

func calcOutputFormatFlags() error {
	if outputSettings == "" || outputSettings == "json" {
		outputSettingsFlags.Format = "json"
		return nil
	}
	parts := strings.Split(outputSettings, ",")
	if parts[0] == "json" {
		if len(parts) > 1 {
			return fmt.Errorf(`the json output format takes no sub-formats, got "%s"`, outputSettings)
		}
		outputSettingsFlags.Format = "json"
		return nil
	}
	if parts[0] != "reg" {
		return fmt.Errorf(`expecting an output format of 'json' or 'reg', got "%s"`, outputSettings)
	}
	outputSettingsFlags.Format = "reg"
	for _, part := range parts[1:] {
		switch part {
		case "hklm":
			if outputSettingsFlags.RegistryHive != "" {
				return fmt.Errorf(`already specified registry hive "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryHive, outputSettings)
			}
			outputSettingsFlags.RegistryHive = part
			break

		case "hkcu":
			if outputSettingsFlags.RegistryHive != "" {
				return fmt.Errorf(`already specified registry hive "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryHive, outputSettings)
			}
			outputSettingsFlags.RegistryHive = part
			break

		case "defaults":
			if outputSettingsFlags.RegistryProfileType != "" {
				return fmt.Errorf(`already specified registry section "%s" in "%s", can't respecify`, outputSettingsFlags.RegistryProfileType, outputSettings)
			}
			outputSettingsFlags.RegistryProfileType = part
			break

		case "locked":
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
		outputSettingsFlags.RegistryHive = "hklm"
	}
	if outputSettingsFlags.RegistryProfileType == "" {
		outputSettingsFlags.RegistryProfileType = "defaults"
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
	} else if outputSettingsFlags.Format == "json" {
		return output, nil
	} else if outputSettingsFlags.Format == "reg" {
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
