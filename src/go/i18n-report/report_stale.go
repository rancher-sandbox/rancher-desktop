// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"flag"
	"fmt"
	"os"
)

func runStale(args []string) error {
	fs := flag.NewFlagSet("stale", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	format := fs.String("format", formatText, "Output format: text, json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := validateFormat(*format); err != nil {
		return err
	}

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportStale(root, *locale, *format)
}

func reportStale(root, locale, format string) error {
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

	stale := computeStale(enKeys, localeKeys)

	return outputStrings(os.Stdout, stale, format, "stale keys in "+locale)
}
