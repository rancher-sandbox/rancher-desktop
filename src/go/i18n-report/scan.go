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

// Patterns for finding translation key references in source code.
var (
	// t('...'), t("..."), t(`...`), also this.t(...) and $t(...)
	keyPattern = regexp.MustCompile(`(?:^|[^a-zA-Z])t\(['"\x60]([a-zA-Z0-9_.]+)['"\x60]`)
	// titleKey/descriptionKey/labelKey properties with string literal values.
	keyPropPattern = regexp.MustCompile(`(?:titleKey|descriptionKey|labelKey):\s*['"]([a-zA-Z0-9_.]+)['"]`)
	// Lines containing a Key property may use ternaries; extract all dotted keys.
	keyPropLine = regexp.MustCompile(`(?:titleKey|descriptionKey|labelKey)[:\s=]`)
	// Dotted key literals in quoted strings.
	dottedKeyLiteral = regexp.MustCompile(`['"]([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)['"]`)
	// label-key="..." in Vue template attributes.
	labelKeyAttrPattern = regexp.MustCompile(`label-key="([a-zA-Z0-9_.]+)"`)
	// v-t="'...'" Vue directive for translation.
	vtDirectivePattern = regexp.MustCompile(`v-t="'([a-zA-Z0-9_.]+)'"`)

	// String values that look like translation keys in property assignments
	// (e.g., `bar: 'product.kubernetesVersion'`). Catches indirect references
	// where the value is later passed to t() by a different component.
	// Validated against the en-us.yaml key set to avoid false positives from
	// settings paths, Kubernetes resource types, and other dotted strings.
	indirectKeyPattern = regexp.MustCompile(`(?:\b\w+|'[^']+'):\s+['"]([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)['"]`)

	// Template literals that look like dynamic translation key patterns.
	// Matches backtick strings containing at least one dot and one ${...}
	// interpolation, with a key-like prefix (e.g., `prefix.${var}.suffix`).
	dynamicKeyLiteral = regexp.MustCompile("\x60([a-zA-Z][a-zA-Z0-9]*\\.[^\x60]*\\$\\{[^}]+\\}[^\x60]*)\x60")

	// Splits a template string on ${...} interpolations.
	interpolationSplit = regexp.MustCompile(`\$\{[^}]+\}`)
)

// segmentWildcard matches key segments produced by an interpolation.
// Includes dots to allow multi-segment keys like "nested.category.item".
const segmentWildcard = `[a-zA-Z0-9_.-]+`

// templateToKeyRegex converts a template literal with ${...} interpolations
// into a regex that matches translation keys. Static parts become literal
// matches; each interpolation becomes a wildcard matching one key segment.
func templateToKeyRegex(template string) *regexp.Regexp {
	parts := interpolationSplit.Split(template, -1)

	var sb strings.Builder
	sb.WriteString("^")
	for i, part := range parts {
		sb.WriteString(regexp.QuoteMeta(part))
		if i < len(parts)-1 {
			sb.WriteString(segmentWildcard)
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
		if !strings.Contains(template, "${") {
			continue
		}
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

// scanFiles reads source files and returns literal key references and
// dynamic patterns. This shared helper avoids scanning the source tree twice.
func scanFiles(root string, keys map[string]string) (map[string][]keyReference, []dynamicKeyRef, error) {
	srcDir := filepath.Join(root, "pkg", "rancher-desktop")
	exts := []string{".vue", ".ts", ".js"}
	files, err := scanSourceFiles(srcDir, exts)
	if err != nil {
		return nil, nil, err
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

	refs := make(map[string][]keyReference)
	var dynamics []dynamicKeyRef

	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: cannot read %s: %v\n", file, err)
			continue
		}
		lines := strings.Split(string(data), "\n")
		for i, line := range lines {
			relPath, _ := filepath.Rel(root, file)
			ref := keyReference{File: relPath, Line: i + 1}

			for _, pat := range []*regexp.Regexp{keyPattern, keyPropPattern, labelKeyAttrPattern, vtDirectivePattern} {
				for _, m := range pat.FindAllStringSubmatch(line, -1) {
					refs[m[1]] = append(refs[m[1]], ref)
				}
			}
			// Lines with key properties may use ternaries; extract all dotted keys.
			if keyPropLine.MatchString(line) {
				for _, m := range dottedKeyLiteral.FindAllStringSubmatch(line, -1) {
					refs[m[1]] = append(refs[m[1]], ref)
				}
			}
			// Indirect key references: only count matches that exist in en-us.yaml.
			for _, m := range indirectKeyPattern.FindAllStringSubmatch(line, -1) {
				if _, exists := keys[m[1]]; exists {
					refs[m[1]] = append(refs[m[1]], ref)
				}
			}
			// Dynamic template literal patterns.
			dynamics = append(dynamics, extractDynamicPatterns(line, ref)...)
		}
	}
	return refs, dynamics, nil
}

// findKeyReferences scans source files for translation key usage,
// including dynamic template literal patterns.
func findKeyReferences(root string, keys map[string]string) (map[string][]keyReference, error) {
	refs, dynamics, err := scanFiles(root, keys)
	if err != nil {
		return nil, err
	}

	// Resolve dynamic patterns: mark all matching keys as referenced.
	for _, d := range dynamics {
		for key := range keys {
			if d.Regex.MatchString(key) {
				refs[key] = append(refs[key], d.Ref)
			}
		}
	}

	return refs, nil
}

// findDynamicPatterns scans source files and returns only the dynamic
// template literal patterns (without resolving them against keys).
func findDynamicPatterns(root string) ([]dynamicKeyRef, error) {
	_, dynamics, err := scanFiles(root, nil)
	return dynamics, err
}
