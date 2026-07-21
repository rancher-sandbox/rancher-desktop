// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
)

func runValidate(args []string) error {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
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
	return reportValidate(os.Stdout, root, *locale)
}

// Check categories reported by validate.
const (
	catSource      = "source"
	catOverride    = "override"
	catPlaceholder = "placeholder"
	catTag         = "tag"
	catICU         = "icu"
	catICUSyntax   = "icu-syntax"
	catIdentical   = "identical"
)

// validationError represents a single validation issue.
type validationError struct {
	Key     string
	Check   string
	Message string
}

// validateLocale runs all structural checks on a locale file and returns
// the errors found. Both reportValidate and reportValidateQuiet use this.
func validateLocale(root, locale string) ([]validationError, error) {
	enPath := translationsPath(root, "en-us.yaml")
	localePath := translationsPath(root, locale+".yaml")

	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return nil, err
	}
	doc, err := loadYAMLDocument(localePath)
	if err != nil {
		return nil, err
	}

	entries, err := loadYAMLWithComments(localePath)
	if err != nil {
		return nil, err
	}
	meta := collectSources(entries)

	var errors []validationError

	// Check placeholder parity, ICU structure, and tag parity.
	for key, enValue := range enKeys {
		localeEntry, exists := entries[key]
		if !exists {
			continue
		}
		localeValue := localeEntry.value
		if errs := checkICU(key, enValue, localeValue); len(errs) > 0 {
			errors = append(errors, errs...)
		}
		if errs := checkTags(key, enValue, localeValue); len(errs) > 0 {
			errors = append(errors, errs...)
		}
	}

	// Check override placement.
	if placement := validateOverridePlacement(doc); len(placement) > 0 {
		for _, key := range placement {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catOverride,
				Message: "@override on parent mapping node (must be on leaf keys only)",
			})
		}
	}

	// Check that every translated key carries a @source snapshot. A @source
	// cannot be orphaned from its translation, since it lives on the key.
	for key := range entries {
		if _, inEn := enKeys[key]; !inEn {
			continue // stale key, reported by stale check
		}
		if _, hasSource := meta[key]; !hasSource {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catSource,
				Message: "translated key has no @source",
			})
		}
	}

	// A translation left identical to its English source must be marked as
	// deliberate with a @reason (or @override) comment; without one it is
	// indistinguishable from a missed translation.
	for key, e := range entries {
		if _, inEn := enKeys[key]; !inEn {
			continue // stale key, reported by stale check
		}
		if e.value == "" {
			continue // an empty source stays empty; nothing to explain
		}
		if storedSource, hasSource := meta[key]; !hasSource || e.value != storedSource {
			continue // no snapshot (reported above), or translated, or drifted
		}
		if e.override || commentHasReason(e.comment) {
			continue
		}
		errors = append(errors, validationError{
			Key:     key,
			Check:   catIdentical,
			Message: "translation identical to source without @reason",
		})
	}

	// Sort errors by key for stable output.
	sort.Slice(errors, func(i, j int) bool {
		if errors[i].Key == errors[j].Key {
			return errors[i].Check < errors[j].Check
		}
		return errors[i].Key < errors[j].Key
	})

	return errors, nil
}

// reportValidate runs structural checks on a locale file.
func reportValidate(w io.Writer, root, locale string) error {
	errors, err := validateLocale(root, locale)
	if err != nil {
		return err
	}

	if len(errors) == 0 {
		fmt.Fprintf(w, "Validation passed for %s.\n", locale)
		return nil
	}

	fmt.Fprintf(w, "Found %d validation %s in %s:\n", len(errors), plural(len(errors), "error"), locale)
	for _, e := range errors {
		fmt.Fprintf(w, "  [%s] %s: %s\n", e.Check, e.Key, e.Message)
	}
	return findingsError(fmt.Sprintf("validation failed with %d %s", len(errors), plural(len(errors), "error")))
}

// containsICU reports whether a value has any ICU syntax worth parsing: a
// placeholder brace or an apostrophe (which may quote literal braces).
func containsICU(s string) bool {
	return strings.ContainsAny(s, "{'")
}

// checkICU runs all ICU-based checks (syntax, placeholder parity, and
// plural/select structure) on a translation value pair.
func checkICU(key, enValue, localeValue string) []validationError {
	if !containsICU(enValue) && !containsICU(localeValue) {
		return nil
	}

	var errors []validationError
	enNodes, enErr := parseICU(enValue)
	localeNodes, localeErr := parseICU(localeValue)
	if enErr != nil {
		errors = append(errors, validationError{
			Key:     key,
			Check:   catICUSyntax,
			Message: fmt.Sprintf("English source fails to parse: %v", enErr),
		})
	}
	if localeErr != nil {
		errors = append(errors, validationError{
			Key:     key,
			Check:   catICUSyntax,
			Message: fmt.Sprintf("translation fails to parse: %v", localeErr),
		})
	}
	if enErr != nil || localeErr != nil {
		return errors
	}

	errors = append(errors, checkPlaceholders(key, enNodes, localeNodes)...)
	errors = append(errors, checkICUStructure(key, enNodes, localeNodes)...)
	return errors
}

// checkPlaceholders verifies that the locale message references the same set of
// argument names as the English source, including names nested inside ICU
// plural/select branches and '#' number substitutions.
func checkPlaceholders(key string, enNodes, localeNodes []icuNode) []validationError {
	enNames := icuArgumentNames(enNodes)
	localeNames := icuArgumentNames(localeNodes)

	var errors []validationError

	// Argument names in English but missing from the locale.
	for _, name := range sortedKeys(enNames) {
		if !localeNames[name] {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catPlaceholder,
				Message: fmt.Sprintf("missing placeholder {%s}", name),
			})
		}
	}

	// Argument names in the locale that are not in English.
	for _, name := range sortedKeys(localeNames) {
		if !enNames[name] {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catPlaceholder,
				Message: fmt.Sprintf("unexpected placeholder {%s}", name),
			})
		}
	}

	return errors
}

// tagRe matches the HTML tags a translation may carry: <tag>, </tag>, <tag/>,
// <tag attr="...">. It is an allowlist so literal angle-bracket prose such as
// "<Binary Data: {n} bytes>" is not mistaken for markup.
var tagRe = regexp.MustCompile(`(?i)</?(a|b|br|code|em|i|li|ol|p|pre|span|strong|ul)\b[^>]*/?>`)

// attrRe matches the HTML attributes a translation must preserve verbatim:
// data-* (runtime click handlers dispatch on them) and href (a translation
// must not change link targets).
var attrRe = regexp.MustCompile(`(?i)(data-[\w-]+|href)=(?:"([^"]*)"|'([^']*)')`)

// checkTags verifies that the locale value contains the same HTML-like
// tag names as the English source, and that required data-* attributes
// are preserved (runtime handlers depend on these).
func checkTags(key, enValue, localeValue string) []validationError {
	enTags := extractTagNames(enValue)
	localeTags := extractTagNames(localeValue)

	var errors []validationError

	for tag, enCount := range enTags {
		localeCount := localeTags[tag]
		if localeCount < enCount {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catTag,
				Message: fmt.Sprintf("missing <%s> tag (expected %d, found %d)", tag, enCount, localeCount),
			})
		}
	}

	for tag, localeCount := range localeTags {
		enCount := enTags[tag]
		if localeCount > enCount {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catTag,
				Message: fmt.Sprintf("unexpected <%s> tag (expected %d, found %d)", tag, enCount, localeCount),
			})
		}
	}

	// Verify that href/data-* attribute values are preserved, comparing the
	// full multiset of values per name so a changed link in a multi-link
	// string is not masked by an unchanged one.
	enAttrs := extractDataAttrs(enValue)
	localeAttrs := extractDataAttrs(localeValue)
	for attr, enVals := range enAttrs {
		localeVals := localeAttrs[attr]
		if slices.Equal(enVals, localeVals) {
			continue
		}
		if len(localeVals) == 0 {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catTag,
				Message: fmt.Sprintf("missing %s attribute (expected %q)", attr, enVals),
			})
		} else {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catTag,
				Message: fmt.Sprintf("%s attribute value changed (expected %q, found %q)", attr, enVals, localeVals),
			})
		}
	}

	return errors
}

// checkICUStructure verifies that ICU plural/select/selectordinal constructs
// in the locale value match those in the English source: same variable, same
// keyword, and same branch labels, recursively through nested constructs.
//
// The match is intentionally exact, plural branch labels included: every
// shipping locale mirrors English's structure, so a dropped or renamed branch
// is a real error. This would wrongly reject a language whose CLDR plural
// categories differ from English (Polish few/many, or a locale that omits the
// never-selected one branch). Relax the plural case — not select — if such a
// locale is added.
func checkICUStructure(key string, enNodes, localeNodes []icuNode) []validationError {
	en := icuConstructs(enNodes)
	locale := icuConstructs(localeNodes)
	if len(en) == 0 && len(locale) == 0 {
		return nil
	}
	return compareConstructs(key, en, locale)
}

// compareConstructs compares two construct trees, reporting missing/unexpected
// constructs, missing/unexpected branch labels, and recursing into nested
// constructs of matched pairs.
func compareConstructs(key string, en, locale []icuConstruct) []validationError {
	enByKey := make(map[string]icuConstruct)
	for _, c := range en {
		enByKey[c.Variable+","+c.Keyword] = c
	}
	localeByKey := make(map[string]icuConstruct)
	for _, c := range locale {
		localeByKey[c.Variable+","+c.Keyword] = c
	}

	var errors []validationError

	// Constructs in English, matched against the locale.
	for _, e := range en {
		loc, found := localeByKey[e.Variable+","+e.Keyword]
		if !found {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catICU,
				Message: fmt.Sprintf("missing {%s, %s, ...} construct", e.Variable, e.Keyword),
			})
			continue
		}
		errors = append(errors, compareBranchLabels(key, &e, &loc)...)
		errors = append(errors, compareConstructs(key, e.Nested, loc.Nested)...)
	}

	// Constructs in the locale but not in English.
	for _, loc := range locale {
		if _, found := enByKey[loc.Variable+","+loc.Keyword]; !found {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catICU,
				Message: fmt.Sprintf("unexpected {%s, %s, ...} construct", loc.Variable, loc.Keyword),
			})
		}
	}

	return errors
}

// compareBranchLabels reports branch labels present in one construct but not
// the other.
func compareBranchLabels(key string, en, locale *icuConstruct) []validationError {
	enBranches := make(map[string]bool)
	for _, b := range en.Branches {
		enBranches[b] = true
	}
	localeBranches := make(map[string]bool)
	for _, b := range locale.Branches {
		localeBranches[b] = true
	}

	var errors []validationError
	for _, b := range en.Branches {
		if !localeBranches[b] {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catICU,
				Message: fmt.Sprintf("missing branch %q in {%s, %s, ...}", b, en.Variable, en.Keyword),
			})
		}
	}
	for _, b := range locale.Branches {
		if !enBranches[b] {
			errors = append(errors, validationError{
				Key:     key,
				Check:   catICU,
				Message: fmt.Sprintf("unexpected branch %q in {%s, %s, ...}", b, locale.Variable, locale.Keyword),
			})
		}
	}
	return errors
}

// extractTagNames returns a count map of HTML-like tag names in a string. Names
// are folded to lower case, because HTML tag names are case-insensitive: a
// translation that writes <B> for English's <b> keeps the same markup.
func extractTagNames(s string) map[string]int {
	matches := tagRe.FindAllStringSubmatch(s, -1)
	result := make(map[string]int)
	for _, m := range matches {
		result[strings.ToLower(m[1])]++
	}
	return result
}

// extractDataAttrs maps each href/data-* attribute name to the sorted list of
// every value it takes in the string. Keeping all occurrences, not just the
// last, lets checkTags catch a changed link target when an attribute repeats.
// Names fold to lower case as in extractTagNames, but values are kept verbatim:
// URL paths and data-* values are case-sensitive.
func extractDataAttrs(s string) map[string][]string {
	matches := attrRe.FindAllStringSubmatch(s, -1)
	result := make(map[string][]string)
	for _, m := range matches {
		// m[2] is the double-quoted value, m[3] is the single-quoted value.
		val := m[2]
		if val == "" {
			val = m[3]
		}
		name := strings.ToLower(m[1])
		result[name] = append(result[name], val)
	}
	for _, vals := range result {
		sort.Strings(vals)
	}
	return result
}
