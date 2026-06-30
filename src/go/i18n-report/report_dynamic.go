package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
)

func runDynamic(args []string) error {
	fs := flag.NewFlagSet("dynamic", flag.ExitOnError)
	format := fs.String("format", "text", "Output format: text, json")
	fs.Parse(args)

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportDynamic(root, *format)
}

type dynamicReportEntry struct {
	Pattern  string   `json:"pattern"`
	Source   string   `json:"source"`
	Matches []string `json:"matches"`
}

func reportDynamic(root, format string) error {
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

	// Build report entries.
	var entries []dynamicReportEntry
	for _, d := range unique {
		var matches []string
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

	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(entries)
	}

	if len(entries) == 0 {
		fmt.Println("No dynamic key patterns found.")
		return nil
	}

	fmt.Printf("Found %d dynamic key patterns:\n\n", len(entries))
	for _, e := range entries {
		fmt.Printf("  %s\n", e.Pattern)
		fmt.Printf("    source:  %s\n", e.Source)
		fmt.Printf("    matches: %d keys\n", len(e.Matches))
		for _, k := range e.Matches {
			fmt.Printf("      %s\n", k)
		}
		fmt.Println()
	}
	return nil
}
