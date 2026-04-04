package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

// normalizeWhitespace collapses newlines and surrounding whitespace into
// single spaces so that multiline values fit on one key=value output line.
// This makes the text format lossy for multiline values; use --format json
// for a lossless round-trip through translate and merge.
func normalizeWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func runTranslate(args []string) error {
	fs := flag.NewFlagSet("translate", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	mode := fs.String("mode", "missing", "Translate mode: missing, improve, drift")
	format := fs.String("format", "text", "Output format: text, json")
	batch := fs.Int("batch", 0, "Batch number (1-indexed); requires --batches")
	batches := fs.Int("batches", 0, "Total number of batches")
	includeOverrides := fs.Bool("include-overrides", false, "In improve mode, include @override keys")
	fs.Parse(args)

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	validModes := map[string]bool{"missing": true, "improve": true, "drift": true}
	if !validModes[*mode] {
		return fmt.Errorf("--mode must be missing, improve, or drift")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportTranslate(root, *locale, *mode, *format, *batch, *batches, *includeOverrides)
}

// reportTranslate outputs key=value pairs for translation. The mode controls
// which keys are included:
//   - missing: keys in en-us.yaml absent from the locale
//   - improve: translated keys eligible for quality review (skip @override by default)
//   - drift: translated keys whose English source has changed
func reportTranslate(root, locale, mode, format string, batch, batches int, includeOverrides bool) error {
	enPath := translationsPath(root, "en-us.yaml")
	localePath := translationsPath(root, locale+".yaml")

	enEntries, err := loadYAMLWithComments(enPath)
	if err != nil {
		return err
	}

	// Build a flat key map for sorting.
	enKeyMap := make(map[string]string, len(enEntries))
	for k, e := range enEntries {
		enKeyMap[k] = e.value
	}

	type kv struct {
		Key     string `json:"key"`
		Value   string `json:"value"`
		Comment string `json:"comment,omitempty"`
	}
	var pairs []kv

	switch mode {
	case "missing":
		localeKeys, err := loadYAMLFlat(localePath)
		if err != nil {
			return err
		}
		for _, k := range sortedKeys(enKeyMap) {
			if _, found := localeKeys[k]; !found {
				pairs = append(pairs, kv{k, enEntries[k].value, enEntries[k].comment})
			}
		}

	case "improve":
		doc, err := loadYAMLDocument(localePath)
		if err != nil {
			return err
		}
		treeRoot := documentRoot(doc)
		localeLeaves := nodeAllLeaves(treeRoot)
		meta, err := loadMetadata(root, locale)
		if err != nil {
			return err
		}
		for _, k := range sortedKeys(enKeyMap) {
			if _, found := localeLeaves[k]; !found {
				continue // missing, not an "improve" candidate
			}
			if !includeOverrides && nodeHasOverride(treeRoot, k) {
				continue // skip @override keys
			}
			// Exclude drifted keys — those belong in translate --mode=drift.
			if storedSource, inMeta := meta[k]; inMeta {
				if enKeyMap[k] != storedSource {
					continue
				}
			}
			pairs = append(pairs, kv{k, enEntries[k].value, enEntries[k].comment})
		}

	case "drift":
		localeKeys, err := loadYAMLFlat(localePath)
		if err != nil {
			return err
		}
		meta, err := loadMetadata(root, locale)
		if err != nil {
			return err
		}
		for _, k := range sortedKeys(enKeyMap) {
			if _, found := localeKeys[k]; !found {
				continue // missing, not drifted
			}
			storedSource, inMeta := meta[k]
			if !inMeta {
				continue // no metadata, cannot detect drift
			}
			if enKeyMap[k] != storedSource {
				pairs = append(pairs, kv{k, enEntries[k].value, enEntries[k].comment})
			}
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

	modeLabel := map[string]string{
		"missing": "missing from",
		"improve": "eligible for improvement in",
		"drift":   "drifted in",
	}[mode]

	if len(pairs) == 0 {
		fmt.Printf("No keys %s %s.\n", modeLabel, locale)
		return nil
	}

	label := fmt.Sprintf("Found %d keys %s %s", len(pairs), modeLabel, locale)
	if batches > 0 {
		label += fmt.Sprintf(" (batch %d of %d)", batch, batches)
	}
	fmt.Printf("%s:\n\n", label)
	for _, p := range pairs {
		if p.Comment != "" {
			fmt.Println(p.Comment)
		}
		fmt.Printf("%s=%s\n", p.Key, normalizeWhitespace(p.Value))
	}
	return nil
}
