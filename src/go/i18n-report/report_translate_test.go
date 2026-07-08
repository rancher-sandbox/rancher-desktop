// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReportTranslateIncludesAnnotations(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)

	enUS := `tray:
  # @context System tray menu, shows active container runtime
  # @no-translate containerd, moby
  containerEngine: "Container engine: {name}"
  preferences: Preferences
locale:
  name: English
`
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)

	// de.yaml has "preferences" but is missing "containerEngine" and "locale.name".
	de := `tray:
  preferences: Einstellungen
`
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(de), 0o644)

	var buf bytes.Buffer
	if err := reportTranslate(&buf, dir, "de", "missing", "text", 0, 0, false); err != nil {
		t.Fatal(err)
	}
	output := buf.String()

	// The annotation from en-us.yaml should appear in the output.
	if !strings.Contains(output, "@context System tray menu") {
		t.Errorf("missing @context annotation in output:\n%s", output)
	}
	if !strings.Contains(output, "@no-translate containerd") {
		t.Errorf("missing @no-translate annotation in output:\n%s", output)
	}
	// The key itself should be present.
	if !strings.Contains(output, "tray.containerEngine=") {
		t.Errorf("missing tray.containerEngine key in output:\n%s", output)
	}
	// Keys without annotations should still appear.
	if !strings.Contains(output, "locale.name=English") {
		t.Errorf("missing locale.name key in output:\n%s", output)
	}
}

func TestReportTranslateJSON(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)

	enUS := `tray:
  # @context System tray tooltip
  status: Running
`
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(""), 0o644)

	var buf bytes.Buffer
	if err := reportTranslate(&buf, dir, "de", "missing", "json", 0, 0, false); err != nil {
		t.Fatal(err)
	}
	output := buf.String()

	// JSON output should include the comment field.
	if !strings.Contains(output, `"comment"`) {
		t.Errorf("JSON output missing comment field:\n%s", output)
	}
	if !strings.Contains(output, "@context System tray tooltip") {
		t.Errorf("JSON output missing annotation:\n%s", output)
	}
}

func setupTranslateTestRepo(t *testing.T, enUS, locale string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0o644)
	return dir
}

// runTranslateReport runs reportTranslate against a buffer and returns
// its output.
func runTranslateReport(t *testing.T, dir, mode string, includeOverrides bool) string {
	t.Helper()
	var buf bytes.Buffer
	if err := reportTranslate(&buf, dir, "de", mode, "text", 0, 0, includeOverrides); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

func TestTranslateModeImprove(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  # @override\n  checking: Manuelle Übersetzung\n  done: Fertig\n"
	dir := setupTranslateTestRepo(t, enUS, de)

	// Improve mode should skip @override keys.
	output := runTranslateReport(t, dir, "improve", false)

	// checking has @override, should be excluded.
	if strings.Contains(output, "status.checking") {
		t.Errorf("@override key should be excluded in improve mode:\n%s", output)
	}
	// done has no override, should be included.
	if !strings.Contains(output, "status.done") {
		t.Errorf("non-override key should be included in improve mode:\n%s", output)
	}
}

func TestTranslateModeImproveIncludeOverrides(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  # @override\n  checking: Manuelle Übersetzung\n  done: Fertig\n"
	dir := setupTranslateTestRepo(t, enUS, de)

	output := runTranslateReport(t, dir, "improve", true)

	// With --include-overrides, both should appear.
	if !strings.Contains(output, "status.checking") {
		t.Errorf("override key should be included with --include-overrides:\n%s", output)
	}
	if !strings.Contains(output, "status.done") {
		t.Errorf("non-override key should be included:\n%s", output)
	}
}

func TestTranslateModeDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupTranslateTestRepo(t, enUS, de)

	// Record @source with current English.
	bootstrapSource(t, dir)

	// Change English for "checking".
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n  done: Done\n"), 0o644)

	output := runTranslateReport(t, dir, "drift", false)

	// Only checking should appear (its English changed).
	if !strings.Contains(output, "status.checking") {
		t.Errorf("drifted key should appear:\n%s", output)
	}
	if strings.Contains(output, "status.done") {
		t.Errorf("non-drifted key should not appear:\n%s", output)
	}
}

func TestTranslateModeImproveExcludesDrifted(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupTranslateTestRepo(t, enUS, de)

	// Bootstrap metadata with current English.
	bootstrapSource(t, dir)

	// Change English for "checking" — this key is now drifted.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n  done: Done\n"), 0o644)

	output := runTranslateReport(t, dir, "improve", false)

	// Drifted key should be excluded from improve mode.
	if strings.Contains(output, "status.checking") {
		t.Errorf("drifted key should be excluded from improve mode:\n%s", output)
	}
	// Non-drifted key should still appear.
	if !strings.Contains(output, "status.done") {
		t.Errorf("non-drifted key should appear in improve mode:\n%s", output)
	}
}

func TestTranslateModeDriftNoDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupTranslateTestRepo(t, enUS, de)

	bootstrapSource(t, dir)

	output := runTranslateReport(t, dir, "drift", false)

	if !strings.Contains(output, "No keys drifted") {
		t.Errorf("expected no drift message, got:\n%s", output)
	}
}
