// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

// i18n-report generates reports for translation maintenance.
//
// Usage:
//
//	i18n-report <subcommand> [flags] [args]
//
// Run "i18n-report" with no arguments for a list of subcommands.
package main

import (
	"errors"
	"fmt"
	"os"
)

// errFindings marks an error that reports problems in the data being checked
// (such as undefined key references) rather than an operational failure (an
// unreadable file, a bad flag). main exits 1 for findings and 2 for
// operational errors, so CI can tell them apart.
var errFindings = errors.New("findings")

// findingsError matches errFindings without wrapping it, so the sentinel
// text stays out of the printed message.
type findingsError string

func (e findingsError) Error() string { return string(e) }

func (findingsError) Is(target error) bool { return target == errFindings }

var subcommands = map[string]func([]string) error{
	"unused":       runUnused,
	"undefined":    runUndefined,
	"stale":        runStale,
	"translate":    runTranslate,
	"merge":        runMerge,
	"untranslated": runUntranslated,
	"references":   runReferences,
	"dynamic":      runDynamic,
	"remove":       runRemove,
	"meta":         runMeta,
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	name := os.Args[1]
	if name == "-h" || name == "--help" || name == "help" {
		printUsage()
		return
	}

	run, ok := subcommands[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "Unknown subcommand: %s\n\n", name)
		printUsage()
		os.Exit(1)
	}

	if err := run(os.Args[2:]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		if errors.Is(err, errFindings) {
			os.Exit(1)
		}
		os.Exit(2)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `Usage: i18n-report <subcommand> [flags] [args]

Subcommands:
  unused        Keys in en-us.yaml not referenced in source code
  undefined     Keys referenced in source code but missing from en-us.yaml
  stale         Keys in a locale file absent from en-us.yaml
  translate     Keys missing from a locale, with English values
  merge         Read flat translations, write nested YAML locale file
  remove        Remove keys from translation files (stdin or --stale)
  untranslated  Hardcoded English strings in Vue/TS files (heuristic)
  references    Where each en-us.yaml key is used (file:line)
  dynamic       Template literal patterns that reference keys dynamically
  meta          Generate source metadata for a locale

Run "i18n-report <subcommand> -h" for subcommand-specific flags.`)
}
