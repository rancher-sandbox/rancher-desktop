package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteAndLoadMetadata(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enKeys := map[string]string{
		"a.b": "Hello",
		"a.c": "World",
		"a.d": "Unused in locale",
	}
	localeKeys := map[string]string{
		"a.b": "Hallo",
		"a.c": "Welt",
		"a.x": "Stale key", // not in enKeys
	}

	err := writeMetadata(dir, "de", enKeys, localeKeys)
	if err != nil {
		t.Fatal(err)
	}

	// Verify file was created.
	path := metadataPath(dir, "de")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("metadata file not created: %v", err)
	}

	// Load it back.
	meta, err := loadMetadata(dir, "de")
	if err != nil {
		t.Fatal(err)
	}

	// Should have entries for a.b and a.c (present in both en and locale).
	if len(meta) != 2 {
		t.Fatalf("expected 2 metadata entries, got %d", len(meta))
	}
	if meta["a.b"] != "Hello" {
		t.Errorf("a.b source mismatch: got %q", meta["a.b"])
	}
	if meta["a.c"] != "World" {
		t.Errorf("a.c source mismatch: got %q", meta["a.c"])
	}

	// a.d (not in locale) and a.x (not in en) should be absent.
	if _, exists := meta["a.d"]; exists {
		t.Error("a.d should not be in metadata (not in locale)")
	}
	if _, exists := meta["a.x"]; exists {
		t.Error("a.x should not be in metadata (stale key)")
	}
}

func TestMetadataDeterministic(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enKeys := map[string]string{"z.a": "Z", "a.z": "A", "m.m": "M"}
	localeKeys := map[string]string{"z.a": "Z2", "a.z": "A2", "m.m": "M2"}

	writeMetadata(dir, "de", enKeys, localeKeys)
	data1, _ := os.ReadFile(metadataPath(dir, "de"))

	// Write again — should produce identical output.
	writeMetadata(dir, "de", enKeys, localeKeys)
	data2, _ := os.ReadFile(metadataPath(dir, "de"))

	if string(data1) != string(data2) {
		t.Error("metadata output is not deterministic")
	}

	// Keys should be in sorted order.
	lines := strings.Split(strings.TrimSpace(string(data1)), "\n")
	var keys []string
	for _, line := range lines {
		if strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, ": ")
		if idx > 0 {
			keys = append(keys, line[:idx])
		}
	}
	if len(keys) != 3 || keys[0] != "a.z" || keys[1] != "m.m" || keys[2] != "z.a" {
		t.Errorf("keys not sorted: %v", keys)
	}
}

func TestLoadMetadataNonExistent(t *testing.T) {
	meta, err := loadMetadata(t.TempDir(), "de")
	if err != nil {
		t.Fatal(err)
	}
	if len(meta) != 0 {
		t.Errorf("expected empty map for non-existent metadata, got %d entries", len(meta))
	}
}

func TestGenerateMetadata(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)

	de := "status:\n  checking: Wird geprüft…\n"
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(de), 0644)

	err := generateMetadata(dir, "de")
	if err != nil {
		t.Fatal(err)
	}

	meta, err := loadMetadata(dir, "de")
	if err != nil {
		t.Fatal(err)
	}

	// Only status.checking is translated.
	if len(meta) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(meta))
	}
	if meta["status.checking"] != "Checking..." {
		t.Errorf("source mismatch for status.checking: got %q", meta["status.checking"])
	}
}

func TestMetadataMultilineRoundTrip(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enKeys := map[string]string{
		"simple":    "Hello world",
		"multiline": "Line one\n\nLine three",
	}
	localeKeys := map[string]string{
		"simple":    "Hallo Welt",
		"multiline": "Zeile eins\n\nZeile drei",
	}

	err := writeMetadata(dir, "de", enKeys, localeKeys)
	if err != nil {
		t.Fatal(err)
	}

	meta, err := loadMetadata(dir, "de")
	if err != nil {
		t.Fatal(err)
	}

	if meta["simple"] != "Hello world" {
		t.Errorf("simple: got %q, want %q", meta["simple"], "Hello world")
	}
	if meta["multiline"] != "Line one\n\nLine three" {
		t.Errorf("multiline: got %q, want %q", meta["multiline"], "Line one\n\nLine three")
	}
}

func TestMergeGeneratesMetadata(t *testing.T) {
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte("status:\n  checking: Wird geprüft…\n"), 0644)

	inputFile := filepath.Join(dir, "input.txt")
	os.WriteFile(inputFile, []byte("status.done=Fertig\n"), 0644)

	err := reportMerge(dir, "de", []string{inputFile}, false, "normal", false)
	if err != nil {
		t.Fatal(err)
	}

	meta, err := loadMetadata(dir, "de")
	if err != nil {
		t.Fatal(err)
	}

	// Both translated keys should have metadata.
	if len(meta) != 2 {
		t.Fatalf("expected 2 metadata entries after merge, got %d", len(meta))
	}
	if meta["status.checking"] != "Checking..." {
		t.Errorf("checking source mismatch: got %q", meta["status.checking"])
	}
	if meta["status.done"] != "Done" {
		t.Errorf("done source mismatch: got %q", meta["status.done"])
	}
}
