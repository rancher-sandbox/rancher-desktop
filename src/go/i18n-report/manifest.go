package main

import (
	"fmt"
	"os"
	"sort"

	"gopkg.in/yaml.v3"
)

// LocaleStatus represents a locale's readiness level.
type LocaleStatus string

const (
	StatusSource       LocaleStatus = "source"
	StatusExperimental LocaleStatus = "experimental"
	StatusShipping     LocaleStatus = "shipping"
)

// LocaleEntry holds the manifest data for a single locale.
type LocaleEntry struct {
	Status LocaleStatus `yaml:"status"`
}

// Manifest holds the parsed meta/locales.yaml content.
type Manifest struct {
	Locales map[string]LocaleEntry `yaml:"locales"`
}

// ManifestLocale is a resolved locale with its code attached.
type ManifestLocale struct {
	Code   string
	Status LocaleStatus
}

// loadManifest reads and validates meta/locales.yaml from the translations directory.
func loadManifest(root string) (*Manifest, error) {
	path := translationsPath(root, "meta/locales.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	var m Manifest
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}

	if err := m.validate(root); err != nil {
		return nil, err
	}
	return &m, nil
}

// validate checks manifest invariants:
//   - at least one locale defined
//   - every status is a recognized value
//   - exactly one locale has status "source"
//   - every non-source locale has a corresponding .yaml file
func (m *Manifest) validate(root string) error {
	if len(m.Locales) == 0 {
		return fmt.Errorf("manifest: no locales defined")
	}

	validStatuses := map[LocaleStatus]bool{
		StatusSource:       true,
		StatusExperimental: true,
		StatusShipping:     true,
	}

	var sources []string
	for code, entry := range m.Locales {
		if !validStatuses[entry.Status] {
			return fmt.Errorf("manifest: locale %q has invalid status %q", code, entry.Status)
		}
		if entry.Status == StatusSource {
			sources = append(sources, code)
		}
	}

	if len(sources) == 0 {
		return fmt.Errorf("manifest: no locale has status %q", StatusSource)
	}
	if len(sources) > 1 {
		sort.Strings(sources)
		return fmt.Errorf("manifest: multiple locales have status %q: %v", StatusSource, sources)
	}

	// Every non-source locale must have a translation file.
	for code, entry := range m.Locales {
		if entry.Status == StatusSource {
			continue
		}
		path := translationsPath(root, code+".yaml")
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return fmt.Errorf("manifest: locale %q listed but %s does not exist", code, path)
		}
	}

	return nil
}

// SourceLocale returns the code of the source locale.
func (m *Manifest) SourceLocale() string {
	for code, entry := range m.Locales {
		if entry.Status == StatusSource {
			return code
		}
	}
	return ""
}

// TranslationLocales returns non-source locales sorted by code.
func (m *Manifest) TranslationLocales() []ManifestLocale {
	var locales []ManifestLocale
	for code, entry := range m.Locales {
		if entry.Status != StatusSource {
			locales = append(locales, ManifestLocale{Code: code, Status: entry.Status})
		}
	}
	sort.Slice(locales, func(i, j int) bool {
		return locales[i].Code < locales[j].Code
	})
	return locales
}
