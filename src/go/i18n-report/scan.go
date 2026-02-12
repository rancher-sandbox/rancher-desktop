package main

import (
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
	// String values that look like translation keys in property assignments
	// (e.g., `bar: 'product.kubernetesVersion'`). Catches indirect references
	// where the value is later passed to t() by a different component.
	// Validated against the en-us.yaml key set to avoid false positives from
	// settings paths, Kubernetes resource types, and other dotted strings.
	indirectKeyPattern = regexp.MustCompile(`(?:\b\w+|'[^']+'):\s+['"]([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)['"]`)
)

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

// findKeyReferences scans source files for translation key usage.
func findKeyReferences(root string, keys map[string]string) (map[string][]keyReference, error) {
	srcDir := filepath.Join(root, "pkg", "rancher-desktop")
	files, err := scanSourceFiles(srcDir, []string{".vue", ".ts", ".js"})
	if err != nil {
		return nil, err
	}

	refs := make(map[string][]keyReference)

	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for i, line := range lines {
			relPath, _ := filepath.Rel(root, file)
			ref := keyReference{File: relPath, Line: i + 1}

			for _, pat := range []*regexp.Regexp{keyPattern, keyPropPattern, labelKeyAttrPattern} {
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
		}
	}
	return refs, nil
}

