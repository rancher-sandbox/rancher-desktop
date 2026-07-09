// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"encoding/json"
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

func TestTranslateRejectsInvalidBatchCounts(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	dir := setupTranslateTestRepo(t, enUS, "{}\n")

	// Negative batch counts must error, not silently disable batching.
	err := reportTranslate(io.Discard, dir, "de", "missing", "text", 1, -2, false)
	if err == nil {
		t.Error("expected an error for --batches=-2, got nil")
	}

	err = reportTranslate(io.Discard, dir, "de", "missing", "text", -1, 3, false)
	if err == nil {
		t.Error("expected an error for --batch=-1, got nil")
	}
}

// TestTranslateBatchesPartitionAllKeys proves the batch slices reproduce the
// unbatched key set exactly: every key appears in exactly one batch, including
// when the batch count exceeds the key count and leaves trailing batches empty.
func TestTranslateBatchesPartitionAllKeys(t *testing.T) {
	enUS := "one: A\ntwo: B\nthree: C\nfour: D\n"
	dir := setupTranslateTestRepo(t, enUS, "{}\n")

	type kv struct {
		Key string `json:"key"`
	}
	collect := func(batch, batches int) []kv {
		var buf bytes.Buffer
		if err := reportTranslate(&buf, dir, "de", "missing", "json", batch, batches, false); err != nil {
			t.Fatalf("batch %d of %d: %v", batch, batches, err)
		}
		var pairs []kv
		if err := json.Unmarshal(buf.Bytes(), &pairs); err != nil {
			t.Fatalf("unmarshal batch %d of %d: %v", batch, batches, err)
		}
		return pairs
	}

	want := collect(0, 0)
	if len(want) != 4 {
		t.Fatalf("unbatched run has %d keys, want 4", len(want))
	}

	// 5 > 4 exercises a batch count larger than the key set.
	for _, batches := range []int{1, 2, 3, 5} {
		seen := map[string]bool{}
		for b := 1; b <= batches; b++ {
			for _, p := range collect(b, batches) {
				if seen[p.Key] {
					t.Errorf("batches=%d: key %q appears in more than one batch", batches, p.Key)
				}
				seen[p.Key] = true
			}
		}
		if len(seen) != len(want) {
			t.Errorf("batches=%d: union has %d keys, want %d", batches, len(seen), len(want))
		}
		for _, p := range want {
			if !seen[p.Key] {
				t.Errorf("batches=%d: key %q missing from every batch", batches, p.Key)
			}
		}
	}
}

// TestTranslateEmptyBatchKeepsHeader verifies that an empty trailing batch
// still reports its batch position instead of the "No keys missing" message,
// which would imply the locale is complete.
func TestTranslateEmptyBatchKeepsHeader(t *testing.T) {
	// One missing key across three batches leaves batch 3 empty.
	dir := setupTranslateTestRepo(t, "only: A\n", "{}\n")

	var buf bytes.Buffer
	if err := reportTranslate(&buf, dir, "de", "missing", "text", 3, 3, false); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "(batch 3 of 3)") {
		t.Errorf("empty batch dropped the batch header:\n%s", out)
	}
	if strings.Contains(out, "No keys") {
		t.Errorf("empty batch printed the completeness message:\n%s", out)
	}
}

// TestTranslateCompleteLocaleMessage verifies the unbatched path still reports
// a complete locale plainly.
func TestTranslateCompleteLocaleMessage(t *testing.T) {
	dir := setupTranslateTestRepo(t, "only: A\n", "only: B\n")

	var buf bytes.Buffer
	if err := reportTranslate(&buf, dir, "de", "missing", "text", 0, 0, false); err != nil {
		t.Fatal(err)
	}
	if out := buf.String(); !strings.Contains(out, "No keys missing from de") {
		t.Errorf("want the completeness message for a fully translated locale, got:\n%s", out)
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
