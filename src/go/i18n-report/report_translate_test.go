package main

import (
	"io"
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
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)

	// de.yaml has "preferences" but is missing "containerEngine" and "locale.name".
	de := `tray:
  preferences: Einstellungen
`
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(de), 0644)

	// Capture stdout.
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := reportTranslate(dir, "de", "missing", "text", 0, 0, false)
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatal(err)
	}

	out, _ := io.ReadAll(r)
	output := string(out)

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
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(""), 0644)

	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := reportTranslate(dir, "de", "missing", "json", 0, 0, false)
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatal(err)
	}

	out, _ := io.ReadAll(r)
	output := string(out)

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
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0644)
	return dir
}

func captureTranslateOutput(t *testing.T, fn func() error) string {
	t.Helper()
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	err := fn()
	w.Close()
	os.Stdout = oldStdout
	if err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(r)
	return string(out)
}

func TestTranslateModeImprove(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  # @override\n  checking: Manuelle Übersetzung\n  done: Fertig\n"
	dir := setupTranslateTestRepo(t, enUS, de)

	// Improve mode should skip @override keys.
	output := captureTranslateOutput(t, func() error {
		return reportTranslate(dir, "de", "improve", "text", 0, 0, false)
	})

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

	output := captureTranslateOutput(t, func() error {
		return reportTranslate(dir, "de", "improve", "text", 0, 0, true)
	})

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

	// Generate metadata with current English.
	generateMetadata(dir, "de")

	// Change English for "checking".
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n  done: Done\n"), 0644)

	output := captureTranslateOutput(t, func() error {
		return reportTranslate(dir, "de", "drift", "text", 0, 0, false)
	})

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
	generateMetadata(dir, "de")

	// Change English for "checking" — this key is now drifted.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n  done: Done\n"), 0644)

	output := captureTranslateOutput(t, func() error {
		return reportTranslate(dir, "de", "improve", "text", 0, 0, false)
	})

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

	generateMetadata(dir, "de")

	output := captureTranslateOutput(t, func() error {
		return reportTranslate(dir, "de", "drift", "text", 0, 0, false)
	})

	if !strings.Contains(output, "No keys drifted") {
		t.Errorf("expected no drift message, got:\n%s", output)
	}
}
