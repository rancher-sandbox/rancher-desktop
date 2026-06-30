package main

import (
	"flag"
)

func runUnused(args []string) error {
	fs := flag.NewFlagSet("unused", flag.ExitOnError)
	format := fs.String("format", "text", "Output format: text, json")
	fs.Parse(args)

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportUnused(root, *format)
}

func reportUnused(root, format string) error {
	enPath := translationsPath(root, "en-us.yaml")
	keys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	refs, err := findKeyReferences(root, keys)
	if err != nil {
		return err
	}

	var unused []string
	for _, k := range sortedKeys(keys) {
		if _, found := refs[k]; !found {
			unused = append(unused, k)
		}
	}

	return outputStrings(unused, format, "unused keys")
}
