package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// outputStrings prints a list of strings in text or JSON format.
func outputStrings(items []string, format, label string) error {
	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(items)
	}

	if len(items) == 0 {
		fmt.Printf("No %s found.\n", label)
		return nil
	}

	fmt.Printf("Found %d %s:\n", len(items), label)
	for _, item := range items {
		fmt.Printf("  %s\n", item)
	}
	return nil
}
