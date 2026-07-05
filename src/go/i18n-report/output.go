// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"encoding/json"
	"fmt"
	"io"
)

// Values accepted by the --format flag of every report.
const (
	formatJSON = "json"
	formatText = "text"
)

// validateFormat rejects unsupported --format values; without it a
// mistyped value would silently render as text.
func validateFormat(format string) error {
	if format != formatText && format != formatJSON {
		return fmt.Errorf("invalid --format value %q (valid: text, json)", format)
	}
	return nil
}

// outputStrings prints a list of strings in text or JSON format.
func outputStrings(w io.Writer, items []string, format, label string) error {
	if format == formatJSON {
		if items == nil {
			items = []string{}
		}
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(items)
	}

	if len(items) == 0 {
		fmt.Fprintf(w, "No %s found.\n", label)
		return nil
	}

	fmt.Fprintf(w, "Found %d %s:\n", len(items), label)
	for _, item := range items {
		fmt.Fprintf(w, "  %s\n", item)
	}
	return nil
}
