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
	"regexp"
	"strings"
	"text/template"
)

var apiSettings struct {
	Method       string
	InputFile    string
	RawFields    []string
	CookedFields []string
}

// apiCmd represents the api command
var apiCmd = &cobra.Command{
	Use:   "api",
	Short: "Run API endpoints directly",
	Long: `Runs API endpoints directly.
Default method is PUT if a body or input file is specified, GET otherwise.

Two ways of specifying a body:
1. --input FILE: Like the existing preferences file. Does not support interpolation.

2. --raw-field|-f name=value : interpolates value as is into the body
	 --field|-F name=value: "smartly" interpolates value into the body:
			 2.1. Strings are wrapped with quotes if not provided;
			 2.2. Numbers and true/false are interpolated without quotes.

Example type-2 command:

rdctl set -F container-engine=moby -F kubernetes-enabled=true -f 'kubernetes-version="1.22.7"'

A special raw-field name of "body" supports specifying a raw payload:

rdctl set -f body='{"kubernetes": {"engine": "moby", "enabled": true, "version": "1.22.7" } }'

It is an error to specify a regular field named body, or other fields along with body.
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return doApiCommand(cmd, args)
	},
}

func init() {
	rootCmd.AddCommand(apiCmd)
	apiCmd.Flags().StringVarP(&apiSettings.Method, "method", "X", "", "Method to use")
	apiCmd.Flags().StringVarP(&apiSettings.InputFile, "input", "", "", "File containing JSON payload to upload")
	apiCmd.Flags().StringArrayVarP(&apiSettings.RawFields, "raw-field", "f", []string{}, "Inject a string parameter in key=value format to the template")
	apiCmd.Flags().StringArrayVarP(&apiSettings.CookedFields, "field", "F", []string{}, "Inject a typed parameter in key=value format to the template")
}

func getNamedBodyTemplate() (string, error) {
	for _, x := range apiSettings.CookedFields {
		if strings.HasPrefix(x, "body=") {
			return "", fmt.Errorf("%s", "only raw fields may contain a body field")
		}
	}
	for _, x := range apiSettings.RawFields {
		if strings.HasPrefix(x, "body=") {
			if len(apiSettings.CookedFields) > 0 || len(apiSettings.RawFields) > 1 {
				return "", fmt.Errorf("%s", "when a body field is specified, no other fields may be specified")
			}
			return strings.SplitN(x, "=", 2)[1], nil
		}
	}
	return "", nil
}

func getBody() (*bytes.Buffer, error) {
	bodyTemplate, err := getNamedBodyTemplate()
	if err != nil {
		return nil, err
	}
	if bodyTemplate != "" {
		return bytes.NewBufferString(bodyTemplate), nil
	}
	if len(apiSettings.RawFields) == 0 && len(apiSettings.CookedFields) == 0 {
		return nil, nil
	}

	containsNonDigit := regexp.MustCompile(`\D`)
	for _, s := range apiSettings.CookedFields {
		parts := strings.SplitN(s, "=", 2)
		if parts[1] == "true" || parts[1] == "false" || containsNonDigit.FindString(parts[1]) == "" {
			apiSettings.RawFields = append(apiSettings.RawFields, s)
		} else if parts[1][0] == '"' && strings.HasSuffix(parts[1], `"`) {
			apiSettings.RawFields = append(apiSettings.RawFields, s)
		} else {
			apiSettings.RawFields = append(apiSettings.RawFields, fmt.Sprintf(`%s="%s"`, parts[0], parts[1]))
		}
	}

	bufTemplate := new(bytes.Buffer)
	bufTemplate.WriteString(`{ "kubernetes": { `)
	values := make(map[string]interface{})
	commaOrEmptyString := ""

	for _, s := range apiSettings.RawFields {
		parts := strings.SplitN(s, "=", 2)
		canonicalName := ""
		switch parts[0] {
		case "container-engine":
			canonicalName = "engine"
		case "kubernetes-enabled":
			canonicalName = "enabled"
		case "kubernetes-version":
			canonicalName = "version"
		}
		if canonicalName == "" {
			return nil, fmt.Errorf("field name %s not recognized", parts[0])
		}
		_, ok := values[canonicalName]
		if !ok {
			bufTemplate.WriteString(fmt.Sprintf(`%s "%s": {{ .%s }}`, commaOrEmptyString, canonicalName, canonicalName))
			commaOrEmptyString = ","
		}
		values[canonicalName] = parts[1]
	}

	bufTemplate.WriteString("} }")
	t := template.Must(template.New("template").Parse(bufTemplate.String()))
	buf := new(bytes.Buffer)
	err = t.Execute(buf, values)
	if err != nil {
		return nil, err
	}
	return buf, nil
}

func doApiCommand(cmd *cobra.Command, args []string) error {
	var result []byte
	var err error

	if apiSettings.InputFile != "" {
		if len(apiSettings.RawFields) > 0 || len(apiSettings.CookedFields) > 0 {
			return fmt.Errorf("fields may not be specified when input from a file is specified")
		}
		if apiSettings.Method == "" {
			apiSettings.Method = "PUT"
		}
		if len(apiSettings.RawFields) > 0 || len(apiSettings.CookedFields) > 0 {
			return fmt.Errorf("fields may be specified only with an in-line body template, not input from a file")
		}
		contents, err := ioutil.ReadFile(apiSettings.InputFile)
		if err != nil {
			return err
		}
		result, err = doRequestWithPayload(apiSettings.Method, args[0], bytes.NewBuffer(contents))
	} else {
		var template *bytes.Buffer

		template, err = getBody()
		if err != nil {
			return err
		}
		if template != nil {
			if apiSettings.Method == "" {
				apiSettings.Method = "PUT"
			}
			result, err = doRequestWithPayload(apiSettings.Method, args[0], template)
		} else {
			if apiSettings.Method == "" {
				apiSettings.Method = "GET"
			}
			result, err = doRequest(apiSettings.Method, args[0])
		}
	}
	if err != nil {
		return err
	}
	if len(result) > 0 {
		fmt.Printf("Status: %s.\n", string(result))
	} else {
		fmt.Printf("Operation successfully returned with no output.")
	}
	return nil
}
