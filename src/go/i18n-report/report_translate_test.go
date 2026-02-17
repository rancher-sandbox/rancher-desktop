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

	err := reportTranslate(dir, "de", "text", 0, 0)
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

	err := reportTranslate(dir, "de", "json", 0, 0)
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
