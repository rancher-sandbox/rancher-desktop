// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// writeMergeFixture creates a repo with the given en-us and locale content.
// meta, if non-empty, is a flat "key: source" map injected inline as @source
// comments on de.yaml, as the co-located model stores it.
func writeMergeFixture(t *testing.T, enUS, locale, meta string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	if err := os.MkdirAll(transDir, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	localePath := filepath.Join(transDir, "de.yaml")
	os.WriteFile(localePath, []byte(locale), 0o644)
	if meta == "" {
		return dir
	}

	sources := map[string]string{}
	if err := yaml.Unmarshal([]byte(meta), &sources); err != nil {
		t.Fatal(err)
	}
	doc, err := loadYAMLDocument(localePath)
	if err != nil {
		t.Fatal(err)
	}
	root := documentRoot(doc)
	for key, src := range sources {
		val, comment, found := nodeGetLeaf(root, key)
		if !found {
			t.Fatalf("meta key %q absent from locale", key)
		}
		if err := nodeSetLeaf(root, key, val, setSourceComment(comment, src)); err != nil {
			t.Fatal(err)
		}
	}
	var buf strings.Builder
	serializeYAMLNode(&buf, doc)
	os.WriteFile(localePath, []byte(buf.String()), 0o644)
	return dir
}

func mergeInputFile(t *testing.T, dir, content string) string {
	t.Helper()
	path := filepath.Join(dir, "input.txt")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestMergeUpdatesMetadataOnlyForMergedKeys(t *testing.T) {
	enUS := "a:\n  b: New English text\n  c: Third key\n"
	locale := "a:\n  b: Alte Übersetzung\n"
	// a.b has drifted; meta still records the old English source.
	meta := "a.b: Old English text\n"
	dir := writeMergeFixture(t, enUS, locale, meta)
	input := mergeInputFile(t, dir, "a.c=Dritter Schlüssel\n")

	if err := reportMerge(io.Discard, dir, "de", []string{input}, false, "normal", false); err != nil {
		t.Fatal(err)
	}

	got, err := loadSources(dir, "de")
	if err != nil {
		t.Fatal(err)
	}
	if got["a.b"] != "Old English text" {
		t.Errorf("merge of a.c erased the drift marker for a.b: meta[a.b] = %q, want %q",
			got["a.b"], "Old English text")
	}
	if got["a.c"] != "Third key" {
		t.Errorf("meta[a.c] = %q, want %q", got["a.c"], "Third key")
	}
}

func TestMergeRefusesToOverwriteMapping(t *testing.T) {
	enUS := "a:\n  b: Leaf in English\n"
	// The locale has diverged; a.b is a mapping with children.
	locale := "a:\n  b:\n    nested: Wert\n    other: Mehr\n"
	dir := writeMergeFixture(t, enUS, locale, "")
	input := mergeInputFile(t, dir, "a.b=Neu\n")

	err := reportMerge(io.Discard, dir, "de", []string{input}, false, "normal", false)
	if err == nil {
		t.Fatal("expected an error overwriting a mapping with a leaf, got nil")
	}

	data, _ := os.ReadFile(filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))
	if !strings.Contains(string(data), "nested: Wert") {
		t.Errorf("locale file was modified despite the error:\n%s", data)
	}
}

func TestMergeReadsTranslateJSONArray(t *testing.T) {
	enUS := "a:\n  multi: |-\n    Line one: {error}\n\n    Line two\n"
	locale := "{}\n"
	dir := writeMergeFixture(t, enUS, locale, "")
	input := mergeInputFile(t, dir,
		`[{"key": "a.multi", "value": "Zeile eins: {error}\n\nZeile zwei"}]`)

	if err := reportMerge(io.Discard, dir, "de", []string{input}, false, "normal", false); err != nil {
		t.Fatal(err)
	}

	got, err := loadYAMLFlat(filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	want := "Zeile eins: {error}\n\nZeile zwei"
	if got["a.multi"] != want {
		t.Errorf("multiline value lost through JSON merge:\ngot:  %q\nwant: %q", got["a.multi"], want)
	}
}

func TestLoadYAMLFlatPreservesScalarText(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")
	content := "a:\n  octal: 0755\n  float: 1.10\n  tilde: ~\n  word: no\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := loadYAMLFlat(path)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{
		"a.octal": "0755",
		"a.float": "1.10",
		"a.tilde": "~",
		"a.word":  "no",
	} {
		if got[key] != want {
			t.Errorf("loadYAMLFlat resolved %s to %q, want raw text %q", key, got[key], want)
		}
	}
}

func TestParseInputDataFormats(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  map[string]string
	}{
		{
			name:  "BOM before first entry",
			input: "\ufeffa.b=Wert eins\na.c=Wert zwei\n",
			want:  map[string]string{"a.b": "Wert eins", "a.c": "Wert zwei"},
		},
		{
			name:  "JSON array",
			input: `[{"key": "a.b", "value": "Wert"}]`,
			want:  map[string]string{"a.b": "Wert"},
		},
		{
			name:  "JSONL assistant message",
			input: `{"message": {"role": "assistant", "content": "a.b=Wert\n"}}`,
			want:  map[string]string{"a.b": "Wert"},
		},
		{
			name:  "flat text",
			input: "a.b: Wert\n",
			want:  map[string]string{"a.b": "Wert"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			entries, err := parseInputData([]byte(tc.input))
			if err != nil {
				t.Fatal(err)
			}
			got := make(map[string]string, len(entries))
			for _, e := range entries {
				got[e.key] = e.value
			}
			for k, want := range tc.want {
				if got[k] != want {
					t.Errorf("entry %s = %q, want %q (all: %v)", k, got[k], want, got)
				}
			}
			if len(got) != len(tc.want) {
				t.Errorf("got %d entries, want %d", len(got), len(tc.want))
			}
		})
	}
}

func TestMergeErrorsOnMissingLocaleFile(t *testing.T) {
	enUS := "a:\n  b: Text\n"
	dir := writeMergeFixture(t, enUS, "{}\n", "")
	input := mergeInputFile(t, dir, "a.b=Wert\n")

	err := reportMerge(io.Discard, dir, "de-DE", []string{input}, false, "normal", false)
	if err == nil {
		t.Fatal("expected an error for a locale without a translation file, got nil")
	}

	typoPath := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de-DE.yaml")
	if _, statErr := os.Stat(typoPath); statErr == nil {
		t.Error("merge created a locale file for an unknown locale")
	}
}

func TestMergeStripsStaleOverrideMarker(t *testing.T) {
	enUS := "a:\n  b: English text\n"
	locale := "a:\n  # @override\n  # hand-tuned wording\n  b: Handgemachte Übersetzung\n"
	dir := writeMergeFixture(t, enUS, locale, "")
	input := mergeInputFile(t, dir, "a.b=Maschinelle Übersetzung\n")

	if err := reportMerge(io.Discard, dir, "de", []string{input}, false, "normal", false); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))
	if strings.Contains(string(data), "@override") {
		t.Errorf("stale @override marker survived a machine overwrite:\n%s", data)
	}
}

func TestMergeRejectsAliases(t *testing.T) {
	enUS := "a:\n  b: Text\n  c: More\n"
	locale := "a:\n  b: &shared Wert\n  c: *shared\n"
	dir := writeMergeFixture(t, enUS, locale, "")
	input := mergeInputFile(t, dir, "a.b=Neu\n")

	if err := reportMerge(io.Discard, dir, "de", []string{input}, false, "normal", false); err == nil {
		t.Fatal("expected an error for a locale file containing aliases, got nil")
	}
}
