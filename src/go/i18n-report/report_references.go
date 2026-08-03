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

func runReferences(args []string) error {
	fs := flag.NewFlagSet("references", flag.ExitOnError)
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
	return reportReferences(os.Stdout, root, *format)
}

func reportReferences(w io.Writer, root, format string) error {
	enPath := translationsPath(root, "en-us.yaml")
	keys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	refs, err := findKeyReferences(root, keys)
	if err != nil {
		return err
	}

	if format == formatJSON {
		// Match text mode: report only keys defined in en-us.yaml. The
		// scanner also collects references to undefined keys; those belong
		// to the undefined report.
		filtered := make(map[string][]keyReference, len(keys))
		for k := range keys {
			if locations := refs[k]; len(locations) > 0 {
				filtered[k] = locations
			}
		}
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(filtered)
	}

	for _, k := range sortedKeys(keys) {
		locations := refs[k]
		if len(locations) == 0 {
			continue
		}
		fmt.Fprintf(w, "%s:\n", k)
		for _, loc := range locations {
			fmt.Fprintf(w, "  %s:%d\n", loc.File, loc.Line)
		}
	}
	return nil
}
