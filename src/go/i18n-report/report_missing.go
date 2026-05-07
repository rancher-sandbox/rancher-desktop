package main

import (
	"flag"
	"fmt"
)

func runMissing(args []string) error {
	fs := flag.NewFlagSet("missing", flag.ExitOnError)
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
	return reportMissing(root, *locale, *format)
}

func reportMissing(root, locale, format string) error {
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
	var missing []string
	for _, k := range sortedKeys(enKeys) {
		if _, found := localeKeys[k]; !found {
			missing = append(missing, k)
		}
	}

	return outputStrings(missing, format, "missing keys in "+locale)
}
