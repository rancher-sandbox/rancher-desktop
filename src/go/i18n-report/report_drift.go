// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
)

// driftEntry describes a single key where English source has changed since
// the translation was last merged.
type driftEntry struct {
	Key      string
	Override bool
}

func runDrift(args []string) error {
	fs := flag.NewFlagSet("drift", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportDrift(os.Stdout, root, *locale)
}

// reportDrift compares stored source-hash metadata against the current English
// source to find translated keys whose English text has changed.
func reportDrift(w io.Writer, root, locale string) error {
	enPath := translationsPath(root, "en-us.yaml")
	localePath := translationsPath(root, locale+".yaml")

	if _, err := os.Stat(localePath); os.IsNotExist(err) {
		return fmt.Errorf("locale file not found: %s", localePath)
	}

	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

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

	// Find drifted keys: current English source differs from stored source.
	var drifted []driftEntry
	for _, key := range computeDrifted(enKeys, meta, localeLeaves) {
		drifted = append(drifted, driftEntry{
			Key:      key,
			Override: nodeHasOverride(treeRoot, key),
		})
	}

	// Report keys missing metadata.
	var missingMeta []string
	for key := range localeLeaves {
		if _, inEn := enKeys[key]; !inEn {
			continue
		}
		if _, inMeta := meta[key]; !inMeta {
			missingMeta = append(missingMeta, key)
		}
	}

	// Report orphaned metadata (metadata for keys that no longer exist in locale).
	var orphanedMeta []string
	for key := range meta {
		if _, inLocale := localeLeaves[key]; !inLocale {
			orphanedMeta = append(orphanedMeta, key)
		}
	}

	// Print results.
	if len(drifted) == 0 && len(missingMeta) == 0 && len(orphanedMeta) == 0 {
		fmt.Fprintf(w, "No drift detected for %s.\n", locale)
		return nil
	}

	sort.Slice(drifted, func(i, j int) bool { return drifted[i].Key < drifted[j].Key })
	sort.Strings(missingMeta)
	sort.Strings(orphanedMeta)

	if len(drifted) > 0 {
		fmt.Fprintf(w, "Found %d drifted keys in %s:\n", len(drifted), locale)
		for _, d := range drifted {
			suffix := ""
			if d.Override {
				suffix = " (@override)"
			}
			fmt.Fprintf(w, "  %s%s\n", d.Key, suffix)
		}
	}

	if len(missingMeta) > 0 {
		fmt.Fprintf(w, "\n%d keys missing metadata:\n", len(missingMeta))
		for _, key := range missingMeta {
			fmt.Fprintf(w, "  %s\n", key)
		}
		fmt.Fprintf(os.Stderr, "Run 'i18n-report meta --locale=%s' to generate missing metadata.\n", locale)
	}

	if len(orphanedMeta) > 0 {
		fmt.Fprintf(w, "\n%d orphaned metadata entries:\n", len(orphanedMeta))
		for _, key := range orphanedMeta {
			fmt.Fprintf(w, "  %s\n", key)
		}
	}

	return findingsError(fmt.Sprintf("found %d drifted, %d missing metadata, %d orphaned metadata",
		len(drifted), len(missingMeta), len(orphanedMeta)))
}
