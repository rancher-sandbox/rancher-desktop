// i18n-report generates reports for translation maintenance.
//
// Usage:
//
//	i18n-report <subcommand> [flags] [args]
//
// Run "i18n-report" with no arguments for a list of subcommands.
package main

import (
	"fmt"
	"os"
)

var subcommands = map[string]func([]string) error{
	"unused":       runUnused,
	"missing":      runMissing,
	"stale":        runStale,
	"translate":    runTranslate,
	"merge":        runMerge,
	"untranslated": runUntranslated,
	"references":   runReferences,
	"check":        runCheck,
	"remove":       runRemove,
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
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `Usage: i18n-report <subcommand> [flags] [args]

Subcommands:
  unused        Keys in en-us.yaml not referenced in source code
  missing       Keys in en-us.yaml absent from a target locale
  stale         Keys in a locale file absent from en-us.yaml
  translate     Keys missing from a locale, with English values
  merge         Read flat translations, write nested YAML locale file
  remove        Remove keys from translation files (stdin or --stale)
  untranslated  Hardcoded English strings in Vue/TS files (heuristic)
  references    Where each en-us.yaml key is used (file:line)
  check         Lint check: unused + stale + missing translations

Run "i18n-report <subcommand> -h" for subcommand-specific flags.`)
}
