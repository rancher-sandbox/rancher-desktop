package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

func runManifest(args []string) error {
	fs := flag.NewFlagSet("manifest", flag.ExitOnError)
	crossValidate := fs.Bool("cross-validate", false, "Also check locale registrations in command-api.yaml")
	fs.Parse(args)

	root, err := repoRoot()
	if err != nil {
		return err
	}

	m, err := loadManifest(root)
	if err != nil {
		return err
	}

	fmt.Printf("Source locale: %s\n", m.SourceLocale())
	fmt.Println("Translation locales:")
	for _, loc := range m.TranslationLocales() {
		fmt.Printf("  %-12s %s\n", loc.Code, loc.Status)
	}
	fmt.Println("Manifest valid.")

	if *crossValidate {
		return crossValidateManifest(root, m)
	}
	return nil
}

// crossValidateManifest checks that the manifest's locale list matches
// the locale enum in command-api.yaml.
func crossValidateManifest(root string, m *Manifest) error {
	apiPath := translationsPath(root, "../specs/command-api.yaml")
	apiLocales, err := parseAPILocaleEnum(apiPath)
	if err != nil {
		return err
	}

	// Build expected set: "none" plus all manifest locales.
	expected := make(map[string]bool)
	expected["none"] = true
	for code := range m.Locales {
		expected[code] = true
	}

	apiSet := make(map[string]bool)
	for _, code := range apiLocales {
		apiSet[code] = true
	}

	var errors []string

	// Locales in manifest but missing from API.
	for code := range expected {
		if !apiSet[code] {
			errors = append(errors, fmt.Sprintf("  manifest locale %q missing from command-api.yaml enum", code))
		}
	}

	// Locales in API but not in manifest (excluding "none").
	for code := range apiSet {
		if !expected[code] {
			errors = append(errors, fmt.Sprintf("  command-api.yaml enum has %q not in manifest", code))
		}
	}

	// Validate settingsValidator.ts uses dynamic locale discovery.
	validatorPath := filepath.Join(root, "pkg", "rancher-desktop", "main",
		"commandServer", "settingsValidator.ts")
	if validatorData, err := os.ReadFile(validatorPath); err != nil {
		errors = append(errors, fmt.Sprintf("  cannot read settingsValidator.ts: %v", err))
	} else {
		content := string(validatorData)
		if !strings.Contains(content, "...availableLocales") {
			errors = append(errors, "  settingsValidator.ts: locale checkEnum does not use ...availableLocales (hardcoded list?)")
		}
	}

	// Validate settingsValidator.spec.ts test values against manifest.
	specPath := filepath.Join(root, "pkg", "rancher-desktop", "main",
		"commandServer", "__tests__", "settingsValidator.spec.ts")
	if specData, err := os.ReadFile(specPath); err != nil {
		errors = append(errors, fmt.Sprintf("  cannot read settingsValidator.spec.ts: %v", err))
	} else {
		specErrors := crossValidateSpec(string(specData), expected)
		errors = append(errors, specErrors...)
	}

	sort.Strings(errors)

	if len(errors) > 0 {
		fmt.Println("\nCross-validation errors:")
		for _, e := range errors {
			fmt.Println(e)
		}
		return fmt.Errorf("cross-validation failed")
	}

	fmt.Println("Cross-validation passed.")
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
	// The locale field is nested under application settings; find it by
	// walking all schema definitions looking for an "application" property
	// with a "locale" child that has an enum.
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
// the settings validator spec are registered in the manifest.
func crossValidateSpec(specContent string, manifestLocales map[string]bool) []string {
	matches := specLocaleRe.FindAllStringSubmatch(specContent, -1)
	seen := make(map[string]bool)
	var errors []string
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
		if !manifestLocales[code] {
			errors = append(errors, fmt.Sprintf("  settingsValidator.spec.ts uses locale %q not in manifest", code))
		}
	}
	return errors
}
