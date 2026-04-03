package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupManifestTestRepo(t *testing.T, manifestYAML string, localeFiles []string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	metaDir := filepath.Join(transDir, "meta")
	os.MkdirAll(metaDir, 0755)

	// Write package.json so repoRoot() can find it.
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0644)

	os.WriteFile(filepath.Join(metaDir, "locales.yaml"), []byte(manifestYAML), 0644)

	// Write en-us.yaml (always needed as source).
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("locale:\n  name: English\n"), 0644)

	for _, name := range localeFiles {
		os.WriteFile(filepath.Join(transDir, name), []byte("locale:\n  name: Test\n"), 0644)
	}
	return dir
}

func TestLoadManifestValid(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: experimental
  zh-hans:
    status: shipping
`, []string{"de.yaml", "zh-hans.yaml"})

	m, err := loadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	if src := m.SourceLocale(); src != "en-us" {
		t.Errorf("SourceLocale() = %q, want %q", src, "en-us")
	}

	locales := m.TranslationLocales()
	if len(locales) != 2 {
		t.Fatalf("got %d translation locales, want 2", len(locales))
	}
	if locales[0].Code != "de" || locales[0].Status != StatusExperimental {
		t.Errorf("locales[0] = %+v, want de/experimental", locales[0])
	}
	if locales[1].Code != "zh-hans" || locales[1].Status != StatusShipping {
		t.Errorf("locales[1] = %+v, want zh-hans/shipping", locales[1])
	}
}

func TestManifestNoLocales(t *testing.T) {
	dir := setupManifestTestRepo(t, "locales:\n", nil)
	_, err := loadManifest(dir)
	if err == nil {
		t.Fatal("expected error for empty manifest")
	}
	if !strings.Contains(err.Error(), "no locales defined") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestManifestNoSource(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  de:
    status: experimental
`, []string{"de.yaml"})

	_, err := loadManifest(dir)
	if err == nil {
		t.Fatal("expected error for missing source")
	}
	if !strings.Contains(err.Error(), "no locale has status") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestManifestMultipleSources(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  en-gb:
    status: source
`, []string{"en-gb.yaml"})

	_, err := loadManifest(dir)
	if err == nil {
		t.Fatal("expected error for multiple sources")
	}
	if !strings.Contains(err.Error(), "multiple locales have status") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestManifestInvalidStatus(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: beta
`, []string{"de.yaml"})

	_, err := loadManifest(dir)
	if err == nil {
		t.Fatal("expected error for invalid status")
	}
	if !strings.Contains(err.Error(), "invalid status") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestManifestMissingLocaleFile(t *testing.T) {
	// de.yaml not created — should fail validation.
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: experimental
`, nil)

	_, err := loadManifest(dir)
	if err == nil {
		t.Fatal("expected error for missing locale file")
	}
	if !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("unexpected error: %v", err)
	}
}
