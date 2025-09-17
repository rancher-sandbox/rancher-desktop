/*
Copyright © 2025 SUSE LLC

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
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/config"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/info"
)

var infoSettings struct {
	Field  string
	Output string
}

// infoCmd represents the `rdctl info` command
var infoCmd = &cobra.Command{
	Use:   "info",
	Short: "Return information about Rancher Desktop",
	Long:  makeLongHelp(),
	RunE:  doInfoCommand,
}

func init() {
	rootCmd.AddCommand(infoCmd)
	infoCmd.Flags().StringVarP(&infoSettings.Field, "field", "f", "", "return only a specific field")
	infoCmd.Flags().VarP(&enumValue{
		val:     "text",
		allowed: []string{"text", "json"},
	}, "output", "o", "output format")
}

// Generates help text for each field available.
func makeLongHelp() string {
	var builder strings.Builder

	_, _ = builder.WriteString("Returns information about Rancher Desktop.  The command returns all\n")
	_, _ = builder.WriteString("fields by default, but a single field can be selected with '--field'.\n")
	_, _ = builder.WriteString("\n")
	_, _ = builder.WriteString("The available fields are:\n")

	typ := reflect.TypeFor[info.Info]()
	for i := range typ.NumField() {
		field := typ.Field(i)
		helpText := field.Tag.Get("help")
		if helpText == "" {
			continue
		}
		fieldName := strings.SplitN(field.Tag.Get("json"), ",", 2)[0]
		_, _ = fmt.Fprintf(&builder, "  %-10s    %s\n", fieldName, helpText)
	}
	return builder.String()
}

func doInfoCommand(cmd *cobra.Command, args []string) error {
	var result info.Info
	var rdClient client.RDClient

	if connectionInfo, err := config.GetConnectionInfo(false); err == nil {
		rdClient = client.NewRDClient(connectionInfo)
	}

	if infoSettings.Field != "" {
		handler, ok := info.Handlers[infoSettings.Field]
		if !ok {
			return fmt.Errorf("unknown field %q", infoSettings.Field)
		}

		// No longer emit usage info on errors
		cmd.SilenceUsage = true

		if err := handler(cmd.Context(), &result, rdClient); err != nil {
			return err
		}

		value := reflect.ValueOf(result)
		typ := value.Type()
		for i := range typ.NumField() {
			field := typ.Field(i)
			tag := strings.SplitN(field.Tag.Get("json"), ",", 2)[0]
			if tag == infoSettings.Field {
				_, err := fmt.Println(value.Field(i).Interface())
				if err != nil {
					return err
				}
				return nil
			}
		}

		return fmt.Errorf("failed to find JSON field %q", infoSettings.Field)
	}

	// No longer emit usage info on errors
	cmd.SilenceUsage = true

	for _, handler := range info.Handlers {
		if err := handler(cmd.Context(), &result, rdClient); err != nil {
			return err
		}
	}

	switch cmd.Flags().Lookup("output").Value.String() {
	case "json":
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(result); err != nil {
			return err
		}
	default:
		writer := tabwriter.NewWriter(os.Stdout, 0, 4, 1, ' ', 0)
		value := reflect.ValueOf(result)
		for i := range value.NumField() {
			field := value.Type().Field(i)
			name, ok := field.Tag.Lookup("name")
			if !ok {
				name = field.Name
			}
			if _, err := fmt.Fprintf(writer, "%s:\t%s\n", name, value.Field(i)); err != nil {
				return err
			}
		}
		if err := writer.Flush(); err != nil {
			return err
		}
	}

	return nil
}
