package main

import (
	"flag"
	"fmt"
)

func runStale(args []string) error {
	fs := flag.NewFlagSet("stale", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	format := fs.String("format", "text", "Output format: text, json")
	fs.Parse(args)

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

	var stale []string
	for _, k := range sortedKeys(localeKeys) {
		if _, found := enKeys[k]; !found {
			stale = append(stale, k)
		}
	}

	return outputStrings(stale, format, "stale keys in "+locale)
}
