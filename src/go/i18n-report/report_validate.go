package main

import (
	"flag"
	"fmt"
	"regexp"
	"sort"
)

func runValidate(args []string) error {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	fs.Parse(args)

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportValidate(root, *locale)
}

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
	localeKeys, err := loadYAMLFlat(localePath)
	if err != nil {
		return nil, err
	}

	doc, err := loadYAMLDocument(localePath)
	if err != nil {
		return nil, err
	}

	meta, err := loadMetadata(root, locale)
	if err != nil {
		return nil, err
	}

	var errors []validationError

	// Check manifest consistency.
	m, manifestErr := loadManifest(root)
	if manifestErr != nil {
		errors = append(errors, validationError{
			Key:     "",
			Check:   "manifest",
			Message: fmt.Sprintf("manifest error: %v", manifestErr),
		})
	} else {
		if _, registered := m.Locales[locale]; !registered {
			errors = append(errors, validationError{
				Key:     "",
				Check:   "manifest",
				Message: fmt.Sprintf("locale %q not registered in meta/locales.yaml", locale),
			})
		}
	}

	// Check placeholder parity, ICU structure, and tag parity.
	for key, enValue := range enKeys {
		localeValue, exists := localeKeys[key]
		if !exists {
			continue
		}
		if errs := checkPlaceholders(key, enValue, localeValue); len(errs) > 0 {
			errors = append(errors, errs...)
		}
		if errs := checkICUStructure(key, enValue, localeValue); len(errs) > 0 {
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
				Check:   "override",
				Message: "@override on parent mapping node (must be on leaf keys only)",
			})
		}
	}

	// Check metadata coherence.
	for key := range localeKeys {
		if _, inEn := enKeys[key]; !inEn {
			continue // stale key, reported by stale check
		}
		if _, inMeta := meta[key]; !inMeta {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "metadata",
				Message: "translated key has no metadata entry",
			})
		}
	}
	for key := range meta {
		if _, inLocale := localeKeys[key]; !inLocale {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "metadata",
				Message: "metadata entry has no corresponding translation",
			})
		}
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
func reportValidate(root, locale string) error {
	errors, err := validateLocale(root, locale)
	if err != nil {
		return err
	}

	if len(errors) == 0 {
		fmt.Printf("Validation passed for %s.\n", locale)
		return nil
	}

	fmt.Printf("Found %d validation errors in %s:\n", len(errors), locale)
	for _, e := range errors {
		fmt.Printf("  [%s] %s: %s\n", e.Check, e.Key, e.Message)
	}
	return fmt.Errorf("validation failed with %d errors", len(errors))
}

// checkPlaceholders verifies that the locale value contains the same
// placeholder names as the English source.
func checkPlaceholders(key, enValue, localeValue string) []validationError {
	enPlaceholders := extractPlaceholderNames(enValue)
	localePlaceholders := extractPlaceholderNames(localeValue)

	var errors []validationError

	// Check for placeholders in English but missing from locale.
	for name := range enPlaceholders {
		if !localePlaceholders[name] {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "placeholder",
				Message: fmt.Sprintf("missing placeholder {%s}", name),
			})
		}
	}

	// Check for extra placeholders in locale not in English.
	for name := range localePlaceholders {
		if !enPlaceholders[name] {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "placeholder",
				Message: fmt.Sprintf("unexpected placeholder {%s}", name),
			})
		}
	}

	return errors
}

// identRe matches a word (\w+) possibly preceded by spaces.
var identRe = regexp.MustCompile(`^\s*(\w+)`)

// extractPlaceholderNames returns the set of top-level placeholder variable
// names from a translation string. Only braces at depth 0 are considered
// placeholders; nested braces (ICU plural/select branches) are skipped.
func extractPlaceholderNames(s string) map[string]bool {
	result := make(map[string]bool)
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{':
			if depth == 0 {
				// Extract the identifier starting after '{'.
				rest := s[i+1:]
				if m := identRe.FindStringSubmatch(rest); m != nil {
					result[m[1]] = true
				}
			}
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
		}
	}
	return result
}

// tagRe matches HTML-like tags: <tag>, </tag>, <tag/>, <tag attr="...">.
var tagRe = regexp.MustCompile(`</?(\w+)[^>]*/?>`)

// attrRe matches HTML attributes of the form name="value" or name='value'.
var attrRe = regexp.MustCompile(`(data-\w+)=(?:"([^"]*)"|'([^']*)')`)

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
				Check:   "tag",
				Message: fmt.Sprintf("missing <%s> tag (expected %d, found %d)", tag, enCount, localeCount),
			})
		}
	}

	for tag, localeCount := range localeTags {
		enCount := enTags[tag]
		if localeCount > enCount {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "tag",
				Message: fmt.Sprintf("unexpected <%s> tag (expected %d, found %d)", tag, enCount, localeCount),
			})
		}
	}

	// Verify that data-* attributes from the English source are preserved.
	enAttrs := extractDataAttrs(enValue)
	localeAttrs := extractDataAttrs(localeValue)
	for attr, enVal := range enAttrs {
		localeVal, ok := localeAttrs[attr]
		if !ok {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "tag",
				Message: fmt.Sprintf("missing %s attribute (expected %q)", attr, enVal),
			})
		} else if localeVal != enVal {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "tag",
				Message: fmt.Sprintf("%s attribute value changed (expected %q, found %q)", attr, enVal, localeVal),
			})
		}
	}

	return errors
}

// icuConstruct represents a parsed ICU plural/select/selectordinal construct.
type icuConstruct struct {
	Variable string   // the variable name (e.g., "count")
	Keyword  string   // "plural", "select", or "selectordinal"
	Branches []string // branch labels (e.g., "one", "other", "=0")
}

// checkICUStructure verifies that ICU plural/select/selectordinal constructs
// in the locale value match those in the English source: same variable, same
// keyword, and same branch labels.
func checkICUStructure(key, enValue, localeValue string) []validationError {
	enICU := extractICUConstructs(enValue)
	localeICU := extractICUConstructs(localeValue)

	if len(enICU) == 0 && len(localeICU) == 0 {
		return nil
	}

	var errors []validationError

	// Build lookup by "variable,keyword" for matching.
	enByKey := make(map[string]icuConstruct)
	for _, c := range enICU {
		enByKey[c.Variable+","+c.Keyword] = c
	}
	localeByKey := make(map[string]icuConstruct)
	for _, c := range localeICU {
		localeByKey[c.Variable+","+c.Keyword] = c
	}

	// Check for ICU constructs in English but missing from locale.
	for ck, en := range enByKey {
		loc, found := localeByKey[ck]
		if !found {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "icu",
				Message: fmt.Sprintf("missing {%s, %s, ...} construct", en.Variable, en.Keyword),
			})
			continue
		}
		// Compare branch labels.
		enBranches := make(map[string]bool)
		for _, b := range en.Branches {
			enBranches[b] = true
		}
		localeBranches := make(map[string]bool)
		for _, b := range loc.Branches {
			localeBranches[b] = true
		}
		for b := range enBranches {
			if !localeBranches[b] {
				errors = append(errors, validationError{
					Key:     key,
					Check:   "icu",
					Message: fmt.Sprintf("missing branch %q in {%s, %s, ...}", b, en.Variable, en.Keyword),
				})
			}
		}
		for b := range localeBranches {
			if !enBranches[b] {
				errors = append(errors, validationError{
					Key:     key,
					Check:   "icu",
					Message: fmt.Sprintf("unexpected branch %q in {%s, %s, ...}", b, loc.Variable, loc.Keyword),
				})
			}
		}
	}

	// Check for ICU constructs in locale but not in English.
	for ck, loc := range localeByKey {
		if _, found := enByKey[ck]; !found {
			errors = append(errors, validationError{
				Key:     key,
				Check:   "icu",
				Message: fmt.Sprintf("unexpected {%s, %s, ...} construct", loc.Variable, loc.Keyword),
			})
		}
	}

	return errors
}

// icuKeywords are the ICU message format keywords that introduce branching.
var icuKeywords = map[string]bool{
	"plural":          true,
	"select":          true,
	"selectordinal":   true,
}

// extractICUConstructs parses top-level ICU plural/select/selectordinal
// constructs from a message string. It finds patterns like:
//
//	{count, plural, one {item} other {items}}
//
// and returns the variable name, keyword, and branch labels.
// extractICUConstructs finds top-level ICU plural/select constructs.
// Known limitation: does not handle ICU single-quote escaping (e.g., '{').
func extractICUConstructs(s string) []icuConstruct {
	var results []icuConstruct
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{':
			if depth == 0 {
				// Try to parse "{var, keyword, branches...}".
				if c, ok := parseICUConstruct(s[i:]); ok {
					results = append(results, c)
				}
			}
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
		}
	}
	return results
}

// parseICUConstruct attempts to parse an ICU construct starting at the
// opening brace. Returns the construct and true if successful.
func parseICUConstruct(s string) (icuConstruct, bool) {
	if len(s) < 2 || s[0] != '{' {
		return icuConstruct{}, false
	}

	// Find the variable name and comma.
	rest := s[1:]
	m := identRe.FindStringSubmatch(rest)
	if m == nil {
		return icuConstruct{}, false
	}
	varName := m[1]
	rest = rest[len(m[0]):]

	// Skip whitespace and expect a comma.
	rest = trimLeft(rest)
	if len(rest) == 0 || rest[0] != ',' {
		return icuConstruct{}, false
	}
	rest = rest[1:]

	// Find the keyword.
	m = identRe.FindStringSubmatch(rest)
	if m == nil {
		return icuConstruct{}, false
	}
	keyword := m[1]
	if !icuKeywords[keyword] {
		return icuConstruct{}, false
	}
	rest = rest[len(m[0]):]

	// Skip whitespace and expect a comma.
	rest = trimLeft(rest)
	if len(rest) == 0 || rest[0] != ',' {
		return icuConstruct{}, false
	}
	rest = rest[1:]

	// Extract branch labels. Branch labels are identifiers or =N before {.
	var branches []string
	for len(rest) > 0 {
		rest = trimLeft(rest)
		if len(rest) == 0 || rest[0] == '}' {
			break
		}
		// Branch label: identifier or =N.
		if rest[0] == '=' {
			// Exact match like =0, =1.
			end := 1
			for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
				end++
			}
			if end > 1 {
				branches = append(branches, rest[:end])
				rest = rest[end:]
			} else {
				break
			}
		} else if m := identRe.FindStringSubmatch(rest); m != nil {
			branches = append(branches, m[1])
			rest = rest[len(m[0]):]
		} else {
			break
		}

		// Skip whitespace, then expect { for branch body.
		rest = trimLeft(rest)
		if len(rest) == 0 || rest[0] != '{' {
			break
		}
		// Skip the branch body by matching braces.
		depth := 0
		j := 0
		for j < len(rest) {
			if rest[j] == '{' {
				depth++
			} else if rest[j] == '}' {
				depth--
				if depth == 0 {
					j++
					break
				}
			}
			j++
		}
		rest = rest[j:]
	}

	if len(branches) == 0 {
		return icuConstruct{}, false
	}

	return icuConstruct{
		Variable: varName,
		Keyword:  keyword,
		Branches: branches,
	}, true
}

// trimLeft trims leading whitespace from a string.
func trimLeft(s string) string {
	i := 0
	for i < len(s) && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r') {
		i++
	}
	return s[i:]
}

// extractTagNames returns a count map of HTML-like tag names in a string.
func extractTagNames(s string) map[string]int {
	matches := tagRe.FindAllStringSubmatch(s, -1)
	result := make(map[string]int)
	for _, m := range matches {
		result[m[1]]++
	}
	return result
}

// extractDataAttrs returns a map of data-* attribute name to value from a string.
func extractDataAttrs(s string) map[string]string {
	matches := attrRe.FindAllStringSubmatch(s, -1)
	result := make(map[string]string)
	for _, m := range matches {
		// m[2] is the double-quoted value, m[3] is the single-quoted value.
		if m[2] != "" {
			result[m[1]] = m[2]
		} else {
			result[m[1]] = m[3]
		}
	}
	return result
}
