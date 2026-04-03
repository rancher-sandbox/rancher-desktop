package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupDriftTestRepo(t *testing.T, enUS, locale string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0644)
	return dir
}

func TestDriftDetectsChangedEnglish(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupDriftTestRepo(t, enUS, de)

	// Generate metadata with current English.
	generateMetadata(dir, "de")

	// Change English text for "checking".
	newEnUS := "status:\n  checking: Verifying...\n  done: Done\n"
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(newEnUS), 0644)

	// Capture stdout.
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := reportDrift(dir, "de")
	w.Close()
	os.Stdout = oldStdout

	if err == nil {
		t.Fatal("expected non-nil error when drift is detected")
	}

	out, _ := io.ReadAll(r)
	output := string(out)

	if !strings.Contains(output, "status.checking") {
		t.Errorf("expected drifted key status.checking in output:\n%s", output)
	}
	// "done" did not change, should not appear.
	if strings.Contains(output, "status.done") {
		t.Errorf("status.done should not be drifted:\n%s", output)
	}
}

func TestDriftNoDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupDriftTestRepo(t, enUS, de)

	generateMetadata(dir, "de")

	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := reportDrift(dir, "de")
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatal(err)
	}

	out, _ := io.ReadAll(r)
	if !strings.Contains(string(out), "No drift detected") {
		t.Errorf("expected no drift, got:\n%s", string(out))
	}
}

func TestDriftFlagsOverride(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  # @override\n  checking: Manuelle Übersetzung\n"
	dir := setupDriftTestRepo(t, enUS, de)

	generateMetadata(dir, "de")

	// Change English.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n"), 0644)

	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	reportDrift(dir, "de")
	w.Close()
	os.Stdout = oldStdout

	out, _ := io.ReadAll(r)
	output := string(out)

	if !strings.Contains(output, "(@override)") {
		t.Errorf("expected @override flag in drift output:\n%s", output)
	}
}

func TestDriftMissingLocaleFile(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	dir := setupDriftTestRepo(t, enUS, "")

	// Remove the locale file so only en-us exists.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.Remove(filepath.Join(transDir, "de.yaml"))

	err := reportDrift(dir, "de")
	if err == nil {
		t.Fatal("expected error for missing locale file")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected 'not found' error, got: %v", err)
	}
}

func TestDriftMissingMetadata(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupDriftTestRepo(t, enUS, de)

	// No metadata generated — both keys should report as missing metadata.
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	reportDrift(dir, "de")
	w.Close()
	os.Stdout = oldStdout

	out, _ := io.ReadAll(r)
	output := string(out)

	if !strings.Contains(output, "missing metadata") {
		t.Errorf("expected missing metadata warning:\n%s", output)
	}
}
