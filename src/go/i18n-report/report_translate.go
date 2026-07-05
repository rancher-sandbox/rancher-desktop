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
	"strings"
)

// normalizeWhitespace collapses newlines and surrounding whitespace into
// single spaces so that multiline values fit on one key=value output line.
// This makes the text format lossy for multiline values; use --format json
// for a lossless round-trip through translate and merge.
func normalizeWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// Translate modes; merge reuses improve and drift for @override handling.
const (
	modeMissing = "missing"
	modeImprove = "improve"
	modeDrift   = "drift"
)

func runTranslate(args []string) error {
	fs := flag.NewFlagSet("translate", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	mode := fs.String("mode", "missing", "Translate mode: missing, improve, drift")
	format := fs.String("format", formatText, "Output format: text, json")
	batch := fs.Int("batch", 0, "Batch number (1-indexed); requires --batches")
	batches := fs.Int("batches", 0, "Total number of batches")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := validateFormat(*format); err != nil {
		return err
	}

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	validModes := map[string]bool{modeMissing: true}
	if !validModes[*mode] {
		return fmt.Errorf("--mode must be missing")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportTranslate(os.Stdout, root, *locale, *mode, *format, *batch, *batches, false)
}

// reportTranslate outputs key=value pairs for translation. The mode controls
// which keys are included:
//   - missing: keys in en-us.yaml absent from the locale
//
// exercised when the improve and drift modes land in the next slice.
//
//nolint:unparam,gocritic // includeOverrides and the single-case switch are
func reportTranslate(w io.Writer, root, locale, mode, format string, batch, batches int, includeOverrides bool) error {
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
	case modeMissing:
		localeKeys, err := loadYAMLFlat(localePath)
		if err != nil {
			return err
		}
		for _, k := range computeMissing(enKeyMap, localeKeys) {
			pairs = append(pairs, kv{k, enEntries[k].value, enEntries[k].comment})
		}
	}

	// Apply batch slicing if requested.
	if batch != 0 || batches != 0 {
		if batches < 1 {
			return fmt.Errorf("--batches must be at least 1")
		}
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

	if format == formatJSON {
		if pairs == nil {
			pairs = []kv{}
		}
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(pairs)
	}

	modeLabel := map[string]string{
		modeMissing: "missing from",
		modeImprove: "eligible for improvement in",
		modeDrift:   "drifted in",
	}[mode]

	if len(pairs) == 0 {
		fmt.Fprintf(w, "No keys %s %s.\n", modeLabel, locale)
		return nil
	}

	label := fmt.Sprintf("Found %d keys %s %s", len(pairs), modeLabel, locale)
	if batches > 0 {
		label += fmt.Sprintf(" (batch %d of %d)", batch, batches)
	}
	fmt.Fprintf(w, "%s:\n\n", label)
	for _, p := range pairs {
		if p.Comment != "" {
			fmt.Fprintln(w, p.Comment)
		}
		fmt.Fprintf(w, "%s=%s\n", p.Key, normalizeWhitespace(p.Value))
	}
	return nil
}
