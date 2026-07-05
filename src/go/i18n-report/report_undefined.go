// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
)

func runUndefined(args []string) error {
	fs := flag.NewFlagSet("undefined", flag.ExitOnError)
	format := fs.String("format", formatText, "Output format: text, json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := validateFormat(*format); err != nil {
		return err
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportUndefined(os.Stdout, root, *format)
}

// reportUndefined lists keys referenced in source code but missing from
// en-us.yaml. Such references render as "%key%" placeholders at runtime,
// so any finding fails the command.
func reportUndefined(w io.Writer, root, format string) error {
	enPath := translationsPath(root, "en-us.yaml")
	keys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	undefined, err := findUndefinedKeys(root, keys)
	if err != nil {
		return err
	}

	if format == formatJSON {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		if err := enc.Encode(undefined); err != nil {
			return err
		}
	} else if len(undefined) == 0 {
		fmt.Fprintln(w, "No undefined keys found.")
	} else {
		fmt.Fprintf(w, "Found %d undefined keys (referenced in code, missing from en-us.yaml):\n", len(undefined))
		for _, k := range sortedKeys(undefined) {
			fmt.Fprintf(w, "  %s\n", k)
			for _, ref := range undefined[k] {
				fmt.Fprintf(w, "    %s:%d\n", ref.File, ref.Line)
			}
		}
	}

	if len(undefined) > 0 {
		return findingsError(fmt.Sprintf("%d undefined keys found", len(undefined)))
	}
	return nil
}
