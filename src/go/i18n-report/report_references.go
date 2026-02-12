package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

func runReferences(args []string) error {
	fs := flag.NewFlagSet("references", flag.ExitOnError)
	format := fs.String("format", "text", "Output format: text, json")
	fs.Parse(args)

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportReferences(root, *format)
}

func reportReferences(root, format string) error {
	enPath := translationsPath(root, "en-us.yaml")
	keys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	refs, err := findKeyReferences(root, keys)
	if err != nil {
		return err
	}

	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(refs)
	}

	for _, k := range sortedKeys(keys) {
		locations := refs[k]
		if len(locations) == 0 {
			continue
		}
		fmt.Printf("%s:\n", k)
		for _, loc := range locations {
			fmt.Printf("  %s:%d\n", loc.File, loc.Line)
		}
	}
	return nil
}
