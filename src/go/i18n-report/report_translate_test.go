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
	os.MkdirAll(transDir, 0755)

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
	os.MkdirAll(transDir, 0755)

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
	os.MkdirAll(transDir, 0755)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0o644)
	return dir
}
