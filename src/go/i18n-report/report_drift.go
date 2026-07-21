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

// reportDrift reports translated keys whose English source changed since
// their stored @source snapshot.
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

	meta, err := loadSources(root, locale)
	if err != nil {
		return err
	}

	// Find drifted keys, recording whether each carries an @override.
	var drifted []driftEntry
	for _, key := range computeDrifted(enKeys, meta, localeLeaves) {
		drifted = append(drifted, driftEntry{
			Key:      key,
			Override: nodeHasOverride(treeRoot, key),
		})
	}

	// Report translated keys that carry no @source snapshot.
	var missingSource []string
	for key := range localeLeaves {
		if _, inEn := enKeys[key]; !inEn {
			continue
		}
		if _, hasSource := meta[key]; !hasSource {
			missingSource = append(missingSource, key)
		}
	}

	// Print results.
	if len(drifted) == 0 && len(missingSource) == 0 {
		fmt.Fprintf(w, "No drift detected for %s.\n", locale)
		return nil
	}

	sort.Slice(drifted, func(i, j int) bool { return drifted[i].Key < drifted[j].Key })
	sort.Strings(missingSource)

	if len(drifted) > 0 {
		fmt.Fprintf(w, "Found %d drifted %s in %s:\n", len(drifted), plural(len(drifted), "key"), locale)
		for _, d := range drifted {
			suffix := ""
			if d.Override {
				suffix = " (@override)"
			}
			fmt.Fprintf(w, "  %s%s\n", d.Key, suffix)
		}
	}

	if len(missingSource) > 0 {
		fmt.Fprintf(w, "\n%d %s missing @source:\n", len(missingSource), plural(len(missingSource), "key"))
		for _, key := range missingSource {
			fmt.Fprintf(w, "  %s\n", key)
		}
		fmt.Fprintf(os.Stderr, "Run 'i18n-report source --locale=%s' to record the missing @source.\n", locale)
	}

	return findingsError(fmt.Sprintf("found %d drifted, %d missing @source", len(drifted), len(missingSource)))
}
