// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"flag"
	"os"
)

func runUnused(args []string) error {
	fs := flag.NewFlagSet("unused", flag.ExitOnError)
	format := fs.String("format", formatText, "Output format: text, json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := validateFormat(*format); err != nil {
		return err
	}

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

	return outputStrings(os.Stdout, unused, format, "unused keys")
}
