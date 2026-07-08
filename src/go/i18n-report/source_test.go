// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"io"
	"os"
	"testing"
)

func TestSourceFromComment(t *testing.T) {
	tests := []struct {
		comment string
		want    string
		ok      bool
	}{
		{"# @source Hello", "Hello", true},
		{"# @override\n# @source Hello", "Hello", true},
		{"# @reason term\n# @source Line one\n# @source Line two", "Line one\nLine two", true},
		{"# @override", "", false},
		{"", "", false},
	}
	for _, tc := range tests {
		got, ok := sourceFromComment(tc.comment)
		if got != tc.want || ok != tc.ok {
			t.Errorf("sourceFromComment(%q) = (%q, %v), want (%q, %v)", tc.comment, got, ok, tc.want, tc.ok)
		}
	}
}

func TestSetSourceComment(t *testing.T) {
	tests := []struct {
		name     string
		existing string
		english  string
		want     string
	}{
		{"bootstrap", "", "Hello", "# @source Hello"},
		{"preserve markers", "# @override\n# @reason term", "Hello", "# @override\n# @reason term\n# @source Hello"},
		{"replace existing", "# @override\n# @source Old", "New", "# @override\n# @source New"},
		{"multiline", "", "Line one\nLine two", "# @source Line one\n# @source Line two"},
	}
	for _, tc := range tests {
		if got := setSourceComment(tc.existing, tc.english); got != tc.want {
			t.Errorf("%s: setSourceComment(%q, %q) = %q, want %q", tc.name, tc.existing, tc.english, got, tc.want)
		}
	}
}

func sourceOf(t *testing.T, dir, key string) (string, bool) {
	t.Helper()
	entries, err := loadYAMLWithComments(translationsPath(dir, "de.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return sourceFromComment(entries[key].comment)
}

func TestAnnotateSourceBootstrap(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n" // only checking translated
	dir := setupLocaleTestRepo(t, enUS, de, true)

	if src, ok := sourceOf(t, dir, "status.checking"); !ok || src != "Checking..." {
		t.Errorf("status.checking @source = (%q, %v), want Checking...", src, ok)
	}
	// status.done is in en-us but not translated, so it never appears in de.yaml.
	entries, _ := loadYAMLWithComments(translationsPath(dir, "de.yaml"))
	if _, exists := entries["status.done"]; exists {
		t.Error("status.done should not appear in de.yaml")
	}
}

func TestAnnotateSourceSkipsStaleKeys(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n  gone: Veraltet\n" // gone absent from en-us
	dir := setupLocaleTestRepo(t, enUS, de, true)

	if _, ok := sourceOf(t, dir, "status.gone"); ok {
		t.Error("stale key status.gone should not get @source")
	}
	if src, ok := sourceOf(t, dir, "status.checking"); !ok || src != "Checking..." {
		t.Errorf("status.checking @source = (%q, %v)", src, ok)
	}
}

func TestAnnotateSourceDottedSegmentKey(t *testing.T) {
	// A leaf key that itself contains dots must be annotated in place, not
	// split into nested mappings (the corruption I2 warned about).
	enUS := "secret:\n  types:\n    'kubernetes.io/dockercfg': Registry\n"
	de := "secret:\n  types:\n    'kubernetes.io/dockercfg': 注册表\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	entries, _ := loadYAMLWithComments(translationsPath(dir, "de.yaml"))
	key := "secret.types.kubernetes.io/dockercfg"
	if _, exists := entries[key]; !exists {
		t.Fatalf("dotted-segment key corrupted; got keys %v", sortedKeys(entries))
	}
	if src, ok := sourceFromComment(entries[key].comment); !ok || src != "Registry" {
		t.Errorf("@source for dotted-segment key = (%q, %v), want Registry", src, ok)
	}
}

func TestAnnotateSourceMultilineEnglish(t *testing.T) {
	enUS := "count: |-\n  {n, plural,\n  one {item}\n  other {items}\n  }\n"
	de := "count: |-\n  {n, plural,\n  one {元素}\n  other {元素}\n  }\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	want := "{n, plural,\none {item}\nother {items}\n}"
	if src, ok := sourceOf(t, dir, "count"); !ok || src != want {
		t.Errorf("multiline @source = (%q, %v), want %q", src, ok, want)
	}
}

func TestAnnotateSourcePreservesOverride(t *testing.T) {
	enUS := "a:\n  b: Hello\n"
	de := "a:\n  # @override\n  # @reason hand-tuned\n  b: Hallo\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	entries, _ := loadYAMLWithComments(translationsPath(dir, "de.yaml"))
	if !commentHasOverride(entries["a.b"].comment) {
		t.Error("@override lost after annotation")
	}
	if src, ok := sourceFromComment(entries["a.b"].comment); !ok || src != "Hello" {
		t.Errorf("@source = (%q, %v) after annotation, want Hello", src, ok)
	}
}

func TestAnnotateSourceIdempotent(t *testing.T) {
	enUS := "a:\n  b: Hello\n  c: World\n"
	de := "a:\n  b: Hallo\n  c: Welt\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)
	path := translationsPath(dir, "de.yaml")

	first, _ := os.ReadFile(path)
	if err := annotateSource(io.Discard, dir, "de", false); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if string(first) != string(second) {
		t.Errorf("annotate not idempotent:\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}
