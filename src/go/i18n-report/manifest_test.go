package main

import (
	"fmt"
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

// writeCrossValidationFiles writes the supporting files needed by
// crossValidateManifest into a test repo directory.
func writeCrossValidationFiles(t *testing.T, dir string, apiEnum string, validatorDynamic bool, specLocales string) {
	t.Helper()

	// command-api.yaml
	specsDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "specs")
	os.MkdirAll(specsDir, 0755)
	apiYAML := fmt.Sprintf(`paths:
  /v1/settings:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                properties:
                  application:
                    properties:
                      locale:
                        type: string
                        enum: [%s]
`, apiEnum)
	os.WriteFile(filepath.Join(specsDir, "command-api.yaml"), []byte(apiYAML), 0644)

	// settingsValidator.ts
	validatorDir := filepath.Join(dir, "pkg", "rancher-desktop", "main", "commandServer")
	os.MkdirAll(validatorDir, 0755)
	validatorContent := "locale: this.checkEnum('none', 'de'),\n"
	if validatorDynamic {
		validatorContent = "locale: this.checkEnum('none', ...availableLocales),\n"
	}
	os.WriteFile(filepath.Join(validatorDir, "settingsValidator.ts"), []byte(validatorContent), 0644)

	// settingsValidator.spec.ts
	testDir := filepath.Join(validatorDir, "__tests__")
	os.MkdirAll(testDir, 0755)
	specContent := fmt.Sprintf(`describe('application.locale', () => {
  it('should accept valid locales', () => {
    %s
  });
  it('should reject invalid values', () => {
    { application: { locale: 'invalid' } }
  });
});
`, specLocales)
	os.WriteFile(filepath.Join(testDir, "settingsValidator.spec.ts"), []byte(specContent), 0644)
}

func TestCrossValidateManifestMatch(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: experimental
`, []string{"de.yaml"})

	writeCrossValidationFiles(t, dir, "none, de, en-us", true,
		"{ application: { locale: 'en-us' } }, { application: { locale: 'de' } }")

	m, err := loadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	err = crossValidateManifest(dir, m)
	if err != nil {
		t.Errorf("cross-validation should pass: %v", err)
	}
}

func TestCrossValidateManifestMismatch(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: experimental
  fa:
    status: experimental
`, []string{"de.yaml", "fa.yaml"})

	// API is missing "fa".
	writeCrossValidationFiles(t, dir, "none, de, en-us", true,
		"{ application: { locale: 'de' } }")

	m, err := loadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	err = crossValidateManifest(dir, m)
	if err == nil {
		t.Error("cross-validation should fail when API is missing a locale")
	}
}

func TestCrossValidateHardcodedValidator(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: experimental
`, []string{"de.yaml"})

	// settingsValidator.ts uses hardcoded list instead of ...availableLocales.
	writeCrossValidationFiles(t, dir, "none, de, en-us", false,
		"{ application: { locale: 'de' } }")

	m, err := loadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	err = crossValidateManifest(dir, m)
	if err == nil {
		t.Error("cross-validation should fail when settingsValidator.ts uses hardcoded locales")
	}
}

func TestCrossValidateSpecUnknownLocale(t *testing.T) {
	dir := setupManifestTestRepo(t, `
locales:
  en-us:
    status: source
  de:
    status: experimental
`, []string{"de.yaml"})

	// Spec references 'fr' which is not in the manifest.
	writeCrossValidationFiles(t, dir, "none, de, en-us", true,
		"{ application: { locale: 'fr' } }")

	m, err := loadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	err = crossValidateManifest(dir, m)
	if err == nil {
		t.Error("cross-validation should fail when spec uses locale not in manifest")
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
