// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckSourceReportsUnusedAsFindings(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	// No source file references status.checking, so it is unused.
	err := reportCheckSource(io.Discard, dir)
	if err == nil {
		t.Fatal("expected findings for an unused key")
	}
	if !errors.Is(err, errFindings) {
		t.Errorf("unused key should be a findings error, got: %v", err)
	}
}

func TestCheckSourcePassesWhenKeyReferenced(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	srcDir := filepath.Join(dir, "pkg", "rancher-desktop", "components")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	source := "<template>\n  <span v-t=\"'status.checking'\" />\n</template>\n"
	if err := os.WriteFile(filepath.Join(srcDir, "Sample.vue"), []byte(source), 0644); err != nil {
		t.Fatal(err)
	}

	if err := reportCheckSource(io.Discard, dir); err != nil {
		t.Errorf("expected source gate to pass, got: %v", err)
	}
}

func TestCheckLocaleFailureIsFindings(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n  removed: Veraltet\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	err := reportCheckLocale(io.Discard, dir, "de", false)
	if !errors.Is(err, errFindings) {
		t.Errorf("check failure should be a findings error, got: %v", err)
	}
}

func TestCheckLocalePassesWithMissingKeys(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	// de has only 1 key — missing keys are OK for the structural checks.
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	err := reportCheckLocale(io.Discard, dir, "de", false)
	if err != nil {
		t.Errorf("structural checks should pass with missing keys, got: %v", err)
	}
}

func TestCheckStrictFailsMissing(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	err := reportCheckLocale(io.Discard, dir, "de", true)
	if err == nil {
		t.Error("strict should fail with missing keys")
	}
}

func TestCheckStrictPasses(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	err := reportCheckLocale(io.Discard, dir, "de", true)
	if err != nil {
		t.Errorf("strict should pass with complete translation, got: %v", err)
	}
}

func TestCheckLocaleFailsStale(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	// de has a stale key not in en-us.
	de := "status:\n  checking: Wird geprüft…\n  removed: Veraltet\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	err := reportCheckLocale(io.Discard, dir, "de", false)
	if err == nil {
		t.Error("structural checks should fail with stale keys")
	}
}

func TestCheckStrictFailsDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	// Change English after metadata was generated.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n"), 0644)

	err := reportCheckLocale(io.Discard, dir, "de", true)
	if err == nil {
		t.Error("strict should fail with drifted keys")
	}
}

// setupRegistrationTestRepo builds a repo fixture with en-us.yaml (including
// locale display names) and the given locale files.
func setupRegistrationTestRepo(t *testing.T, localeFiles []string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0o644)

	enUS := "locale:\n  de: German\n  en-us: English\n  fa: Farsi\n"
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)

	for _, name := range localeFiles {
		os.WriteFile(filepath.Join(transDir, name), []byte("locale:\n  name: Test\n"), 0o644)
	}
	return dir
}

// writeCrossValidationFiles writes the registration surfaces that
// reportCheckRegistration inspects into a test repo directory.
func writeCrossValidationFiles(t *testing.T, dir string, apiEnum string, validatorDynamic bool, specLocales string) {
	t.Helper()

	// command-api.yaml
	specsDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "specs")
	os.MkdirAll(specsDir, 0o755)
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
	os.WriteFile(filepath.Join(specsDir, "command-api.yaml"), []byte(apiYAML), 0o644)

	// settingsValidator.ts
	validatorDir := filepath.Join(dir, "pkg", "rancher-desktop", "main", "commandServer")
	os.MkdirAll(validatorDir, 0o755)
	validatorContent := "locale: this.checkEnum('none', 'de'),\n"
	if validatorDynamic {
		validatorContent = "locale: this.checkEnum('none', ...availableLocales),\n"
	}
	os.WriteFile(filepath.Join(validatorDir, "settingsValidator.ts"), []byte(validatorContent), 0o644)

	// settingsValidator.spec.ts
	testDir := filepath.Join(validatorDir, "__tests__")
	os.MkdirAll(testDir, 0o755)
	specContent := fmt.Sprintf(`describe('application.locale', () => {
  it('should accept valid locales', () => {
    %s
  });
  it('should reject invalid values', () => {
    { application: { locale: 'invalid' } }
  });
});
`, specLocales)
	os.WriteFile(filepath.Join(testDir, "settingsValidator.spec.ts"), []byte(specContent), 0o644)
}

// checkRegistration derives the locale list from the fixture directory and
// runs reportCheckRegistration on it.
func checkRegistration(t *testing.T, dir string) error {
	t.Helper()
	locales, err := translationLocales(dir)
	if err != nil {
		t.Fatal(err)
	}
	return reportCheckRegistration(io.Discard, dir, locales)
}

func TestCheckRegistrationMatch(t *testing.T) {
	dir := setupRegistrationTestRepo(t, []string{"de.yaml"})
	writeCrossValidationFiles(t, dir, "none, de, en-us", true,
		"{ application: { locale: 'en-us' } }, { application: { locale: 'de' } }")

	if err := checkRegistration(t, dir); err != nil {
		t.Errorf("registration checks should pass: %v", err)
	}
}

func TestCheckRegistrationMissingFromEnum(t *testing.T) {
	dir := setupRegistrationTestRepo(t, []string{"de.yaml", "fa.yaml"})

	// The API enum is missing "fa".
	writeCrossValidationFiles(t, dir, "none, de, en-us", true,
		"{ application: { locale: 'de' } }")

	err := checkRegistration(t, dir)
	if err == nil {
		t.Fatal("registration checks should fail when the enum is missing a locale")
	}
	if !errors.Is(err, errFindings) {
		t.Errorf("registration mismatch should be a findings error, got: %v", err)
	}
}

func TestCheckRegistrationEnumWithoutFile(t *testing.T) {
	dir := setupRegistrationTestRepo(t, []string{"de.yaml"})

	// The API enum lists "fa", but fa.yaml does not exist.
	writeCrossValidationFiles(t, dir, "none, de, en-us, fa", true,
		"{ application: { locale: 'de' } }")

	if err := checkRegistration(t, dir); err == nil {
		t.Error("registration checks should fail when the enum has a locale with no file")
	}
}

func TestCheckRegistrationHardcodedValidator(t *testing.T) {
	dir := setupRegistrationTestRepo(t, []string{"de.yaml"})

	// settingsValidator.ts uses a hardcoded list instead of ...availableLocales.
	writeCrossValidationFiles(t, dir, "none, de, en-us", false,
		"{ application: { locale: 'de' } }")

	if err := checkRegistration(t, dir); err == nil {
		t.Error("registration checks should fail when settingsValidator.ts uses hardcoded locales")
	}
}

func TestCheckRegistrationSpecUnknownLocale(t *testing.T) {
	dir := setupRegistrationTestRepo(t, []string{"de.yaml"})

	// The spec references 'fr', which has no translation file.
	writeCrossValidationFiles(t, dir, "none, de, en-us", true,
		"{ application: { locale: 'fr' } }")

	if err := checkRegistration(t, dir); err == nil {
		t.Error("registration checks should fail when the spec uses a locale with no file")
	}
}

func TestCheckRegistrationMissingDisplayName(t *testing.T) {
	dir := setupRegistrationTestRepo(t, []string{"de.yaml", "pt.yaml"})

	// en-us.yaml has no locale.pt display name.
	writeCrossValidationFiles(t, dir, "none, de, en-us, pt", true,
		"{ application: { locale: 'de' } }")

	if err := checkRegistration(t, dir); err == nil {
		t.Error("registration checks should fail when en-us.yaml lacks a locale display name")
	}
}
