package main

import (
	"os"
	"path/filepath"
	"testing"
)

func setupCheckTestRepo(t *testing.T, enUS, locale string, withMeta bool, localeStatus ...string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	metaDir := filepath.Join(transDir, "meta")
	os.MkdirAll(metaDir, 0755)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0644)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0644)

	status := "experimental"
	if len(localeStatus) > 0 {
		status = localeStatus[0]
	}
	manifest := "locales:\n  en-us:\n    status: source\n  de:\n    status: " + status + "\n"
	os.WriteFile(filepath.Join(metaDir, "locales.yaml"), []byte(manifest), 0644)

	if withMeta {
		generateMetadata(dir, "de")
	}
	return dir
}

func TestCheckPolicyExperimentalPasses(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	// de has only 1 key — missing keys are OK for experimental.
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupCheckTestRepo(t, enUS, de, true)

	err := reportCheckPolicy(dir, "de", "experimental")
	if err != nil {
		t.Errorf("experimental should pass with missing keys, got: %v", err)
	}
}

func TestCheckPolicyShippingFailsMissing(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupCheckTestRepo(t, enUS, de, true, "shipping")

	err := reportCheckPolicy(dir, "de", "shipping")
	if err == nil {
		t.Error("shipping should fail with missing keys")
	}
}

func TestCheckPolicyShippingPasses(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupCheckTestRepo(t, enUS, de, true, "shipping")

	err := reportCheckPolicy(dir, "de", "shipping")
	if err != nil {
		t.Errorf("shipping should pass with complete translation, got: %v", err)
	}
}

func TestCheckPolicyShippingFailsExperimentalStatus(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupCheckTestRepo(t, enUS, de, true, "experimental")

	err := reportCheckPolicy(dir, "de", "shipping")
	if err == nil {
		t.Error("shipping should fail for experimental-status locale")
	}
}

func TestCheckPolicyExperimentalFailsStale(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	// de has a stale key not in en-us.
	de := "status:\n  checking: Wird geprüft…\n  removed: Veraltet\n"
	dir := setupCheckTestRepo(t, enUS, de, true)

	err := reportCheckPolicy(dir, "de", "experimental")
	if err == nil {
		t.Error("experimental should fail with stale keys")
	}
}

func TestCheckPolicyShippingFailsDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupCheckTestRepo(t, enUS, de, true, "shipping")

	// Change English after metadata was generated.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n"), 0644)

	err := reportCheckPolicy(dir, "de", "shipping")
	if err == nil {
		t.Error("shipping should fail with drifted keys")
	}
}
