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

// plural returns noun for a count of one and its regular plural (noun+"s")
// otherwise, so a formatted count reads naturally: "1 key", "0 keys", "2 keys".
func plural(n int, noun string) string {
	if n == 1 {
		return noun
	}
	return noun + "s"
}

// outputStrings prints a list of strings in text or JSON format. In text mode
// the header pluralizes noun to match the count and appends suffix, a trailing
// phrase such as " in de" (empty for none).
func outputStrings(w io.Writer, items []string, format, noun, suffix string) error {
	if format == formatJSON {
		if items == nil {
			items = []string{}
		}
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(items)
	}

	if len(items) == 0 {
		// suffix trails "found" here, unlike the header below: "No stale keys
		// found in de" reads naturally where "No stale keys in de found" does not.
		fmt.Fprintf(w, "No %s found%s.\n", plural(0, noun), suffix)
		return nil
	}

	fmt.Fprintf(w, "Found %d %s%s:\n", len(items), plural(len(items), noun), suffix)
	for _, item := range items {
		fmt.Fprintf(w, "  %s\n", item)
	}
	return nil
}
