// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// keyReference records where a translation key is used.
type keyReference struct {
	File string `json:"file"`
	Line int    `json:"line"`
}

// dynamicKeyRef records a template literal pattern that references
// translation keys via interpolation (e.g., `prefix.${var}.suffix`).
type dynamicKeyRef struct {
	Template string         // raw template content
	Pattern  string         // human-readable: "prefix.{}.suffix"
	Regex    *regexp.Regexp // compiled regex for matching keys
	Ref      keyReference   // source location
}

// dottedKey matches a translation key: segments of [a-zA-Z0-9_-] joined
// by single dots. It rejects leading, trailing, and consecutive dots.
// Segments allow hyphens because keys such as reverse-sshfs and en-us do.
const dottedKey = `[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*`

// Patterns for finding translation key references in source code.
var (
	// t('...'), t("..."), t(`...`), also this.t(...) and $t(...)
	keyPattern = regexp.MustCompile(`(?:^|[^a-zA-Z])t\(['"\x60](` + dottedKey + `)['"\x60]`)
	// titleKey/descriptionKey/labelKey properties with string literal values.
	keyPropPattern = regexp.MustCompile(`(?:titleKey|descriptionKey|labelKey):\s*['"](` + dottedKey + `)['"]`)
	// Lines containing a Key property may use ternaries; extract all dotted keys.
	keyPropLine = regexp.MustCompile(`(?:titleKey|descriptionKey|labelKey)[:\s=]`)
	// Dotted key literals in quoted strings.
	dottedKeyLiteral = regexp.MustCompile(`['"]([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)['"]`)
	// Vue template attributes that pass translation keys: bare k="..." on
	// the <t> component and any *-key="..." attribute (label-key,
	// no-rows-key, ...). Bound forms (:label-key="expr") are expressions,
	// not keys, and are excluded by the leading ^|\s requirement.
	keyAttrPattern = regexp.MustCompile(`(?:^|\s)(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*-key|k)=['"](` + dottedKey + `)['"]`)
	// v-t="'...'" Vue directive for translation.
	vtDirectivePattern = regexp.MustCompile(`v-t="'(` + dottedKey + `)'"`)
	// Direct store getter calls: getters['i18n/t']('key').
	getterCallPattern = regexp.MustCompile(`\['i18n/t'\]\(\s*['"\x60](` + dottedKey + `)['"\x60]`)
	// t( calls with the key literal on the following line.
	multilineKeyPattern = regexp.MustCompile(`(?:^|[^a-zA-Z])t\(\s*\n\s*['"\x60](` + dottedKey + `)['"\x60]`)
	// Comment lines; keys mentioned in comments are not real references.
	commentLinePattern = regexp.MustCompile(`^\s*(//|\*|/\*|<!--)`)

	// String values that look like translation keys in property assignments
	// (e.g., `bar: 'product.kubernetesVersion'`). Catches indirect references
	// where the value is later passed to t() by a different component.
	// Validated against the en-us.yaml key set to avoid false positives from
	// settings paths, Kubernetes resource types, and other dotted strings.
	indirectKeyPattern = regexp.MustCompile(`(?:\b\w+|'[^']+'|"[^"]+"):\s+['"]([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)['"]`)

	// Template literals that look like dynamic translation key patterns.
	// Matches backtick strings containing at least one dot and one ${...}
	// interpolation, with a key-like prefix (e.g., `prefix.${var}.suffix`).
	dynamicKeyLiteral = regexp.MustCompile("\x60([a-zA-Z][a-zA-Z0-9]*\\.[^\x60]*\\$\\{[^}]+\\}[^\x60]*)\x60")

	// Splits a template string on ${...} interpolations.
	interpolationSplit = regexp.MustCompile(`\$\{[^}]+\}`)
)

// templateToKeyRegex converts a template literal with ${...} interpolations
// into a regex that matches translation keys. Static parts become literal
// matches; each interpolation becomes a dottedKey wildcard spanning one or
// more key segments.
func templateToKeyRegex(template string) *regexp.Regexp {
	parts := interpolationSplit.Split(template, -1)

	var sb strings.Builder
	sb.WriteString("^")
	for i, part := range parts {
		sb.WriteString(regexp.QuoteMeta(part))
		if i < len(parts)-1 {
			sb.WriteString(dottedKey)
		}
	}
	sb.WriteString("$")

	re, err := regexp.Compile(sb.String())
	if err != nil {
		return nil
	}
	return re
}

// templateToHumanPattern converts a template literal to a readable pattern
// by replacing ${...} interpolations with {}.
func templateToHumanPattern(template string) string {
	return interpolationSplit.ReplaceAllString(template, "{}")
}

// extractDynamicPatterns finds dynamic template literal key patterns in a line.
func extractDynamicPatterns(line string, ref keyReference) []dynamicKeyRef {
	var dynamics []dynamicKeyRef
	for _, m := range dynamicKeyLiteral.FindAllStringSubmatch(line, -1) {
		template := m[1]
		re := templateToKeyRegex(template)
		if re == nil {
			continue
		}
		dynamics = append(dynamics, dynamicKeyRef{
			Template: template,
			Pattern:  templateToHumanPattern(template),
			Regex:    re,
			Ref:      ref,
		})
	}
	return dynamics
}

// sourceExtensions are the file types scanned for translation keys.
var sourceExtensions = []string{".vue", ".ts", ".js"}

// scanSourceFiles walks the source tree and returns file paths matching
// the given extensions.
func scanSourceFiles(root string, exts []string) ([]string, error) {
	var files []string
	extSet := make(map[string]bool, len(exts))
	for _, e := range exts {
		extSet[e] = true
	}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if name == "node_modules" || name == ".git" || name == "dist" || name == "vendor" || name == "__tests__" {
				return filepath.SkipDir
			}
			return nil
		}
		if extSet[filepath.Ext(name)] {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}

// scanResult holds everything one pass over the source tree produces.
type scanResult struct {
	// refs maps keys to all references, including indirect ones (string
	// values matching existing keys).
	refs map[string][]keyReference
	// directRefs maps keys to unambiguous references only: t() calls,
	// key props, key attributes, and v-t directives. Safe to compare
	// against the key set to find referenced-but-undefined keys.
	directRefs map[string][]keyReference
	dynamics   []dynamicKeyRef
}

// scanFiles reads source files and returns literal key references and
// dynamic patterns. This shared helper avoids scanning the source tree twice.
func scanFiles(root string, keys map[string]string) (*scanResult, error) {
	srcDir := filepath.Join(root, "pkg", "rancher-desktop")
	exts := sourceExtensions
	files, err := scanSourceFiles(srcDir, exts)
	if err != nil {
		return nil, err
	}

	// Also scan root-level source files (e.g. background.ts).
	extSet := make(map[string]bool, len(exts))
	for _, e := range exts {
		extSet[e] = true
	}
	if entries, err := os.ReadDir(root); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && extSet[filepath.Ext(entry.Name())] {
				files = append(files, filepath.Join(root, entry.Name()))
			}
		}
	}

	result := &scanResult{
		refs:       make(map[string][]keyReference),
		directRefs: make(map[string][]keyReference),
	}
	// appendRef skips consecutive duplicates; several patterns can match
	// the same key on the same line.
	appendRef := func(list []keyReference, ref keyReference) []keyReference {
		if n := len(list); n > 0 && list[n-1] == ref {
			return list
		}
		return append(list, ref)
	}
	addDirect := func(key string, ref keyReference) {
		result.refs[key] = appendRef(result.refs[key], ref)
		result.directRefs[key] = appendRef(result.directRefs[key], ref)
	}

	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			// An unreadable file could hide key references, so it is an
			// operational failure (exit 2), not a partial result.
			return nil, fmt.Errorf("reading %s: %w", file, err)
		}
		relPath, _ := filepath.Rel(root, file)
		content := string(data)
		lines := strings.Split(content, "\n")
		for i, line := range lines {
			if commentLinePattern.MatchString(line) {
				continue
			}
			ref := keyReference{File: relPath, Line: i + 1}

			for _, pat := range []*regexp.Regexp{keyPattern, keyPropPattern, keyAttrPattern, vtDirectivePattern, getterCallPattern} {
				for _, m := range pat.FindAllStringSubmatch(line, -1) {
					addDirect(m[1], ref)
				}
			}
			// Lines with key properties may use ternaries; extract all dotted keys.
			if keyPropLine.MatchString(line) {
				for _, m := range dottedKeyLiteral.FindAllStringSubmatch(line, -1) {
					addDirect(m[1], ref)
				}
			}
			// Indirect key references: only count matches that exist in en-us.yaml.
			for _, m := range indirectKeyPattern.FindAllStringSubmatch(line, -1) {
				if _, exists := keys[m[1]]; exists {
					result.refs[m[1]] = appendRef(result.refs[m[1]], ref)
				}
			}
			// Dynamic template literal patterns.
			result.dynamics = append(result.dynamics, extractDynamicPatterns(line, ref)...)
		}
		// Multi-line t( calls span lines, so match against the whole file.
		for _, m := range multilineKeyPattern.FindAllStringSubmatchIndex(content, -1) {
			key := content[m[2]:m[3]]
			line := 1 + strings.Count(content[:m[2]], "\n")
			addDirect(key, keyReference{File: relPath, Line: line})
		}
	}
	return result, nil
}

// findKeyReferences scans source files for translation key usage,
// including dynamic template literal patterns.
func findKeyReferences(root string, keys map[string]string) (map[string][]keyReference, error) {
	result, err := scanFiles(root, keys)
	if err != nil {
		return nil, err
	}

	// Resolve dynamic patterns: mark all matching keys as referenced.
	for _, d := range result.dynamics {
		for key := range keys {
			if d.Regex.MatchString(key) {
				result.refs[key] = append(result.refs[key], d.Ref)
			}
		}
	}

	return result.refs, nil
}

// findUndefinedKeys returns direct references to keys that are missing from
// the key set. Indirect references are excluded: settings paths and other
// dotted strings match the indirect pattern, so without the key-set filter
// they would flood this report with false positives.
func findUndefinedKeys(root string, keys map[string]string) (map[string][]keyReference, error) {
	result, err := scanFiles(root, keys)
	if err != nil {
		return nil, err
	}

	undefined := make(map[string][]keyReference)
	for key, refs := range result.directRefs {
		if _, exists := keys[key]; !exists {
			undefined[key] = refs
		}
	}
	return undefined, nil
}

// findDynamicPatterns scans source files and returns only the dynamic
// template literal patterns (without resolving them against keys).
func findDynamicPatterns(root string) ([]dynamicKeyRef, error) {
	result, err := scanFiles(root, nil)
	if err != nil {
		return nil, err
	}
	return result.dynamics, nil
}
