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
	"sort"
)

func runDynamic(args []string) error {
	fs := flag.NewFlagSet("dynamic", flag.ExitOnError)
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
	return reportDynamic(os.Stdout, root, *format)
}

type dynamicReportEntry struct {
	Pattern string   `json:"pattern"`
	Source  string   `json:"source"`
	Matches []string `json:"matches"`
}

func reportDynamic(w io.Writer, root, format string) error {
	dynamics, err := findDynamicPatterns(root)
	if err != nil {
		return err
	}

	// Load en-us.yaml to show which keys each pattern matches.
	enPath := translationsPath(root, "en-us.yaml")
	keys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	// Deduplicate patterns (same template from different lines).
	// Reports only the first location for each dynamic pattern; additional
	// occurrences are omitted.
	seen := make(map[string]bool)
	var unique []dynamicKeyRef
	for _, d := range dynamics {
		if !seen[d.Pattern] {
			seen[d.Pattern] = true
			unique = append(unique, d)
		}
	}
	sort.Slice(unique, func(i, j int) bool {
		return unique[i].Pattern < unique[j].Pattern
	})

	// Build report entries. Both slices start empty, not nil, so JSON
	// output contains [] instead of null.
	entries := []dynamicReportEntry{}
	for _, d := range unique {
		matches := []string{}
		for _, k := range sortedKeys(keys) {
			if d.Regex.MatchString(k) {
				matches = append(matches, k)
			}
		}
		entries = append(entries, dynamicReportEntry{
			Pattern: d.Pattern,
			Source:  fmt.Sprintf("%s:%d", d.Ref.File, d.Ref.Line),
			Matches: matches,
		})
	}

	if format == formatJSON {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(entries)
	}

	if len(entries) == 0 {
		fmt.Fprintln(w, "No dynamic key patterns found.")
		return nil
	}

	fmt.Fprintf(w, "Found %d dynamic key patterns:\n\n", len(entries))
	for _, e := range entries {
		fmt.Fprintf(w, "  %s\n", e.Pattern)
		fmt.Fprintf(w, "    source:  %s\n", e.Source)
		fmt.Fprintf(w, "    matches: %d keys\n", len(e.Matches))
		for _, k := range e.Matches {
			fmt.Fprintf(w, "      %s\n", k)
		}
		fmt.Fprintln(w)
	}
	return nil
}
