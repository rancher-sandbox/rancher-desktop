// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// runCheck is the CI gate. Bare `check` runs the locale-independent source
// gate (unused + undefined keys). With --locale it also verifies the locale
// registration surfaces and runs the per-locale checks; --locale=all covers
// every translation file on disk. --strict adds the completeness checks
// (no missing, no drifted keys) for periodic and pre-release runs, while
// PR CI uses the default structural set.
func runCheck(args []string) error {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale, or 'all' (omit for the source-only gate)")
	strict := fs.Bool("strict", false, "Require complete translations: no missing, no drifted keys (requires --locale)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *strict && *locale == "" {
		return fmt.Errorf("--strict requires --locale")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}

	available, err := translationLocales(root)
	if err != nil {
		return err
	}

	// Reject a bad single --locale before the source gate prints, so it is an
	// operational error like drift's rather than a per-locale finding surfaced
	// after a partial pass. --locale=all needs no such check.
	if *locale != "" && *locale != localeAll {
		if *locale == sourceLocale {
			return fmt.Errorf("locale %q is the source locale; per-locale checks do not apply", *locale)
		}
		if !slices.Contains(available, *locale) {
			return fmt.Errorf("no translation file for locale %q", *locale)
		}
	}

	// The source gate always runs. An operational failure (unreadable file)
	// aborts immediately; findings are collected and combined with the
	// per-locale results below.
	sourceErr := reportCheckSource(os.Stdout, root)
	if sourceErr != nil && !errors.Is(sourceErr, errFindings) {
		return sourceErr
	}

	if *locale == "" {
		return sourceErr
	}

	failed := sourceErr != nil

	fmt.Println()
	if regErr := reportCheckRegistration(os.Stdout, root, available); regErr != nil {
		if !errors.Is(regErr, errFindings) {
			return regErr
		}
		failed = true
	}

	locales := available
	if *locale != localeAll {
		locales = []string{*locale}
	}

	for _, loc := range locales {
		fmt.Println()
		if err := reportCheckLocale(os.Stdout, root, loc, *strict); err != nil {
			if !errors.Is(err, errFindings) {
				return err
			}
			failed = true
		}
	}

	if failed {
		return findingsError("check failed")
	}
	return nil
}

// reportCheckSource runs the locale-independent source gate: keys defined in
// en-us.yaml but referenced nowhere (unused) and keys referenced in source
// but missing from en-us.yaml (undefined). Undefined keys render as "%key%"
// placeholders in every locale, so they fail regardless of locale.
func reportCheckSource(w io.Writer, root string) error {
	enPath := translationsPath(root, "en-us.yaml")
	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	refs, err := findKeyReferences(root, enKeys)
	if err != nil {
		return err
	}
	unusedCount := len(computeUnused(enKeys, refs))

	undefined, err := findUndefinedKeys(root, enKeys)
	if err != nil {
		return err
	}

	fmt.Fprintln(w, "Source checks:")
	passed := true
	printResult := func(label string, count int) {
		status := "OK"
		if count > 0 {
			status = "FAIL"
			passed = false
		}
		fmt.Fprintf(w, "  %-30s %3d  %s\n", label+":", count, status)
	}

	printResult("unused keys", unusedCount)
	printResult("undefined keys", len(undefined))

	if passed {
		fmt.Fprintln(w, "Source checks passed.")
		return nil
	}
	return findingsError("source checks failed")
}

// reportCheckRegistration checks that every locale registration surface
// agrees with the translation files on disk: the locale enum in
// command-api.yaml, the settingsValidator.ts enum construction, the
// validator spec's test values, and the locale.* display-name keys in
// en-us.yaml.
func reportCheckRegistration(w io.Writer, root string, locales []string) error {
	apiLocales, err := parseAPILocaleEnum(translationsPath(root, "../specs/command-api.yaml"))
	if err != nil {
		return err
	}

	// The expected enum: the source locale and every translation file on disk.
	expected := map[string]bool{sourceLocale: true}
	for _, code := range locales {
		expected[code] = true
	}

	apiSet := make(map[string]bool)
	for _, code := range apiLocales {
		apiSet[code] = true
	}

	var problems []string

	for code := range expected {
		if !apiSet[code] {
			problems = append(problems, fmt.Sprintf("  locale %q missing from command-api.yaml enum", code))
		}
	}
	for code := range apiSet {
		if !expected[code] {
			problems = append(problems, fmt.Sprintf("  command-api.yaml enum has %q with no translation file", code))
		}
	}

	// settingsValidator.ts must build its enum from the translation files
	// instead of a hardcoded list. An unreadable registration file is an
	// operational failure, like an unreadable command-api.yaml above; only a
	// present-but-wrong file is a finding.
	validatorPath := filepath.Join(root, "pkg", "rancher-desktop", "main",
		"commandServer", "settingsValidator.ts")
	validatorData, err := os.ReadFile(validatorPath)
	if err != nil {
		return fmt.Errorf("reading settingsValidator.ts: %w", err)
	}
	if !strings.Contains(string(validatorData), "...availableLocales") {
		problems = append(problems, "  settingsValidator.ts: locale checkEnum does not use ...availableLocales (hardcoded list?)")
	}

	// Validate settingsValidator.spec.ts test values.
	specPath := filepath.Join(root, "pkg", "rancher-desktop", "main",
		"commandServer", "__tests__", "settingsValidator.spec.ts")
	specData, err := os.ReadFile(specPath)
	if err != nil {
		return fmt.Errorf("reading settingsValidator.spec.ts: %w", err)
	}
	problems = append(problems, crossValidateSpec(string(specData), expected)...)

	// Every locale needs a display name for the language picker.
	enKeys, err := loadYAMLFlat(translationsPath(root, "en-us.yaml"))
	if err != nil {
		return fmt.Errorf("reading en-us.yaml: %w", err)
	}
	for _, code := range append([]string{sourceLocale}, locales...) {
		if _, exists := enKeys["locale."+code]; !exists {
			problems = append(problems, fmt.Sprintf("  en-us.yaml is missing the display-name key %q", "locale."+code))
		}
	}

	sort.Strings(problems)

	fmt.Fprintln(w, "Registration checks:")
	if len(problems) > 0 {
		for _, p := range problems {
			fmt.Fprintln(w, p)
		}
		return findingsError("registration checks failed")
	}
	fmt.Fprintln(w, "Registration checks passed.")
	return nil
}

// parseAPILocaleEnum extracts the locale enum values from command-api.yaml
// by parsing the YAML structure instead of using fragile regex matching.
func parseAPILocaleEnum(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading command-api.yaml: %w", err)
	}

	// Parse into a generic structure and navigate to the locale enum.
	var doc map[string]interface{}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parsing command-api.yaml: %w", err)
	}

	// Navigate: paths.*.*.properties.application.properties.locale.enum
	// The locale enum sits deep under application settings; find it by
	// recursively searching every map for a "locale" property that has an
	// "enum".
	locales := findLocaleEnum(doc)
	if locales == nil {
		return nil, fmt.Errorf("could not find locale enum in command-api.yaml")
	}
	return locales, nil
}

// findLocaleEnum searches a parsed YAML structure for a "locale" property
// definition that contains an "enum" list, returning the enum values.
func findLocaleEnum(v interface{}) []string {
	switch node := v.(type) {
	case map[string]interface{}:
		// If this map has a "locale" key whose value has an "enum", that's it.
		if locale, found := node["locale"]; found {
			if localeMap, ok := locale.(map[string]interface{}); ok {
				if enumVal, hasEnum := localeMap["enum"]; hasEnum {
					if items, ok := enumVal.([]interface{}); ok {
						var result []string
						for _, item := range items {
							if s, ok := item.(string); ok {
								result = append(result, s)
							}
						}
						if len(result) > 0 {
							return result
						}
					}
				}
			}
		}
		// Recurse into all map values.
		for _, val := range node {
			if result := findLocaleEnum(val); result != nil {
				return result
			}
		}
	case []interface{}:
		for _, val := range node {
			if result := findLocaleEnum(val); result != nil {
				return result
			}
		}
	}
	return nil
}

// specLocaleRe matches locale string values in test assertions, e.g.:
//
//	{ application: { locale: 'de' } }
var specLocaleRe = regexp.MustCompile(`locale:\s*'([a-z][\w-]*)'`)

// crossValidateSpec checks that locale values used as valid inputs in
// the settings validator spec correspond to translation files on disk.
func crossValidateSpec(specContent string, knownLocales map[string]bool) []string {
	matches := specLocaleRe.FindAllStringSubmatch(specContent, -1)
	seen := make(map[string]bool)
	var problems []string
	for _, m := range matches {
		code := m[1]
		if seen[code] {
			continue
		}
		seen[code] = true
		// "none" and "invalid" are special test values, not real locales.
		if code == "none" || code == "invalid" {
			continue
		}
		if !knownLocales[code] {
			problems = append(problems, fmt.Sprintf("  settingsValidator.spec.ts uses locale %q with no translation file", code))
		}
	}
	return problems
}

// reportCheckLocale runs the per-locale checks:
//   - locale file present
//   - no stale keys
//   - validate passes (placeholders, ICU structure, tags, metadata)
//
// With strict, the locale must also be complete:
//   - no missing keys
//   - no drifted keys
func reportCheckLocale(w io.Writer, root, locale string, strict bool) error {
	passed := true
	printResult := func(label string, ok bool, detail string) {
		status := "OK"
		if !ok {
			status = "FAIL"
			passed = false
		}
		if detail != "" {
			fmt.Fprintf(w, "  %-35s %s  %s\n", label+":", status, detail)
		} else {
			fmt.Fprintf(w, "  %-35s %s\n", label+":", status)
		}
	}

	label := "Checks"
	if strict {
		label = "Strict checks"
	}
	fmt.Fprintf(w, "%s for %s:\n", label, locale)

	localePath := translationsPath(root, locale+".yaml")
	enPath := translationsPath(root, "en-us.yaml")

	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	localeKeys, localeErr := loadYAMLFlat(localePath)
	printResult("locale file readable", localeErr == nil, errString(localeErr))
	if localeErr != nil {
		localeKeys = make(map[string]string)
	}

	// No stale keys.
	staleCount := len(computeStale(enKeys, localeKeys))
	printResult("no stale keys", staleCount == 0, countDetail(staleCount))

	// Validate passes.
	validateErr := reportValidateQuiet(root, locale)
	printResult("validate passes", validateErr == nil, errString(validateErr))

	// Load @source snapshots for the drift check below. Their coherence is
	// already covered by the "validate passes" check above (validateLocale
	// checks it).
	meta, metaErr := loadSources(root, locale)
	if metaErr != nil {
		printResult("@source readable", false, errString(metaErr))
	}

	// Completeness checks.
	if strict {
		missingCount := len(computeMissing(enKeys, localeKeys))
		printResult("no missing keys", missingCount == 0, countDetail(missingCount))

		if meta != nil {
			driftCount := len(computeDrifted(enKeys, meta, localeKeys))
			printResult("no drifted keys", driftCount == 0, countDetail(driftCount))
		}
	}

	if passed {
		fmt.Fprintf(w, "All checks passed for %s.\n", locale)
		return nil
	}
	return findingsError(fmt.Sprintf("checks failed for %s", locale))
}

// reportValidateQuiet runs validate and returns an error summary without
// printing individual errors.
func reportValidateQuiet(root, locale string) error {
	errs, err := validateLocale(root, locale)
	if err != nil {
		return err
	}
	if len(errs) > 0 {
		return fmt.Errorf("%d validation %s", len(errs), plural(len(errs), "error"))
	}
	return nil
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func countDetail(count int) string {
	if count == 0 {
		return ""
	}
	return fmt.Sprintf("%d found", count)
}
