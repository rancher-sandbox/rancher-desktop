package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

func runTranslate(args []string) error {
	fs := flag.NewFlagSet("translate", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	format := fs.String("format", "text", "Output format: text, json")
	batch := fs.Int("batch", 0, "Batch number (1-indexed); requires --batches")
	batches := fs.Int("batches", 0, "Total number of batches")
	fs.Parse(args)

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportTranslate(root, *locale, *format, *batch, *batches)
}

// reportTranslate outputs key=value pairs for keys in en-us.yaml that are
// missing from a locale file. This is the input for translation agents.
func reportTranslate(root, locale, format string, batch, batches int) error {
	enPath := translationsPath(root, "en-us.yaml")
	localePath := translationsPath(root, locale+".yaml")

	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}
	localeKeys, err := loadYAMLFlat(localePath)
	if err != nil {
		return err
	}

	type kv struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	var pairs []kv
	for _, k := range sortedKeys(enKeys) {
		if _, found := localeKeys[k]; !found {
			pairs = append(pairs, kv{k, enKeys[k]})
		}
	}

	// Apply batch slicing if requested.
	if batch > 0 && batches == 0 {
		return fmt.Errorf("--batch requires --batches")
	}
	if batches > 0 && batch == 0 {
		return fmt.Errorf("--batches requires --batch")
	}
	if batches > 0 {
		if batch < 1 || batch > batches {
			return fmt.Errorf("--batch must be between 1 and %d", batches)
		}
		total := len(pairs)
		size := (total + batches - 1) / batches
		start := (batch - 1) * size
		end := start + size
		if start > total {
			start = total
		}
		if end > total {
			end = total
		}
		pairs = pairs[start:end]
	}

	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(pairs)
	}

	if len(pairs) == 0 {
		fmt.Printf("No keys missing from %s.\n", locale)
		return nil
	}

	label := fmt.Sprintf("Found %d keys missing from %s", len(pairs), locale)
	if batches > 0 {
		label += fmt.Sprintf(" (batch %d of %d)", batch, batches)
	}
	fmt.Printf("%s:\n\n", label)
	for _, p := range pairs {
		fmt.Printf("%s=%s\n", p.Key, p.Value)
	}
	return nil
}
