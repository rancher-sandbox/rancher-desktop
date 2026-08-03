// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// mustParseICU parses an ICU message, failing the test if it does not parse.
func mustParseICU(t *testing.T, msg string) []icuNode {
	t.Helper()
	nodes, err := parseICU(msg)
	if err != nil {
		t.Fatalf("parseICU(%q): %v", msg, err)
	}
	return nodes
}

func TestCheckPlaceholders(t *testing.T) {
	tests := []struct {
		name        string
		enValue     string
		localeValue string
		wantErrors  int
	}{
		{
			name:        "matching placeholders",
			enValue:     "Hello {name}, you have {count} items",
			localeValue: "Hallo {name}, Sie haben {count} Artikel",
			wantErrors:  0,
		},
		{
			name:        "missing placeholder",
			enValue:     "Hello {name}",
			localeValue: "Hallo",
			wantErrors:  1,
		},
		{
			name:        "extra placeholder",
			enValue:     "Hello",
			localeValue: "Hallo {name}",
			wantErrors:  1,
		},
		{
			name:        "ICU plural",
			enValue:     "{count, plural, one {item} other {items}}",
			localeValue: "{count, plural, one {Artikel} other {Artikel}}",
			wantErrors:  0,
		},
		{
			name:        "spaced placeholder",
			enValue:     "Error { action } failed",
			localeValue: "Fehler { action } fehlgeschlagen",
			wantErrors:  0,
		},
		{
			name:        "no placeholders",
			enValue:     "Simple text",
			localeValue: "Einfacher Text",
			wantErrors:  0,
		},
		{
			name:        "nested placeholder dropped",
			enValue:     "{pages, plural, other {{from} - {to} of {count}}}",
			localeValue: "{pages, plural, other {{from} - {to}}}",
			wantErrors:  1, // count is nested and missing in locale
		},
		{
			name:        "quoted literal is not a placeholder",
			enValue:     "'{version}'",
			localeValue: "wörtlich",
			wantErrors:  0, // fully quoted: no placeholder on either side
		},
		{
			name:        "apostrophe-wrapped placeholder",
			enValue:     "''{version}''",
			localeValue: "Version",
			wantErrors:  1, // '' is a literal apostrophe; version is a real placeholder
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errs := checkPlaceholders("test.key", mustParseICU(t, tc.enValue), mustParseICU(t, tc.localeValue))
			if len(errs) != tc.wantErrors {
				t.Errorf("got %d errors, want %d: %v", len(errs), tc.wantErrors, errs)
			}
		})
	}
}

func TestCheckTags(t *testing.T) {
	tests := []struct {
		name        string
		enValue     string
		localeValue string
		wantErrors  int
	}{
		{
			name:        "matching tags",
			enValue:     "<b>bold</b> and <a href='x'>link</a>",
			localeValue: "<b>fett</b> und <a href='x'>Link</a>",
			wantErrors:  0,
		},
		{
			name:        "missing tag",
			enValue:     "<b>bold</b>",
			localeValue: "fett",
			wantErrors:  1, // missing <b>
		},
		{
			name:        "extra tag",
			enValue:     "plain text",
			localeValue: "<b>fett</b>",
			wantErrors:  1,
		},
		{
			name:        "self-closing tag",
			enValue:     "line1<br/>line2",
			localeValue: "Zeile1<br/>Zeile2",
			wantErrors:  0,
		},
		{
			name:        "code tag",
			enValue:     "use <code>kubectl</code>",
			localeValue: "benutze <code>kubectl</code>",
			wantErrors:  0,
		},
		{
			name:        "no tags",
			enValue:     "plain text",
			localeValue: "einfacher Text",
			wantErrors:  0,
		},
		{
			name:        "changed href",
			enValue:     `see <a href="https://docs.example/">docs</a>`,
			localeValue: `siehe <a href="https://evil.example/">Doku</a>`,
			wantErrors:  1,
		},
		{
			name:        "dropped href",
			enValue:     `see <a href="https://docs.example/">docs</a>`,
			localeValue: `siehe <a>Doku</a>`,
			wantErrors:  1,
		},
		{
			name:        "changed first of two links",
			enValue:     `<a href="https://a.example/">x</a> and <a href="https://b.example/">y</a>`,
			localeValue: `<a href="https://evil.example/">x</a> und <a href="https://b.example/">y</a>`,
			wantErrors:  1, // first href changed; must not collapse to the last
		},
		{
			name:        "identical two-link string",
			enValue:     `<a href="https://a.example/">x</a> <a href="https://b.example/">y</a>`,
			localeValue: `<a href="https://a.example/">x</a> <a href="https://b.example/">y</a>`,
			wantErrors:  0,
		},
		{
			name:        "changed hyphenated data attribute",
			enValue:     `<span data-test-id="alpha">x</span>`,
			localeValue: `<span data-test-id="beta">x</span>`,
			wantErrors:  1,
		},
		{
			name:        "literal angle-bracket prose is not a tag",
			enValue:     "<Binary Data: {n, number} bytes>",
			localeValue: "<二进制数据: {n, number} bytes>",
			wantErrors:  0,
		},
		{
			name:        "uppercase tag is the same tag",
			enValue:     "<b>bold</b>",
			localeValue: "<B>fett</B>",
			wantErrors:  0, // HTML tag names are case-insensitive
		},
		{
			name:        "uppercase attribute name is the same attribute",
			enValue:     `<a href="https://docs.example/Guide">docs</a>`,
			localeValue: `<a HREF="https://docs.example/Guide">Doku</a>`,
			wantErrors:  0, // HTML attribute names are case-insensitive
		},
		{
			name:        "attribute value case still matters",
			enValue:     `<a href="https://docs.example/Guide">docs</a>`,
			localeValue: `<a href="https://docs.example/guide">Doku</a>`,
			wantErrors:  1, // URL paths are case-sensitive
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errs := checkTags("test.key", tc.enValue, tc.localeValue)
			if len(errs) != tc.wantErrors {
				t.Errorf("got %d errors, want %d: %v", len(errs), tc.wantErrors, errs)
			}
		})
	}
}

func TestCheckICUStructure(t *testing.T) {
	tests := []struct {
		name        string
		enValue     string
		localeValue string
		wantErrors  int
	}{
		{
			name:        "matching plural",
			enValue:     "Delete {count} {count, plural, one {image} other {images}}?",
			localeValue: "{count} {count, plural, one {Image} other {Images}} löschen?",
			wantErrors:  0,
		},
		{
			name:        "missing plural construct",
			enValue:     "{count, plural, one {item} other {items}}",
			localeValue: "{count} Artikel",
			wantErrors:  1,
		},
		{
			name:        "extra plural construct",
			enValue:     "{count} items",
			localeValue: "{count, plural, one {Artikel} other {Artikel}}",
			wantErrors:  1,
		},
		{
			name:        "missing branch",
			enValue:     "{count, plural, =0 {none} one {item} other {items}}",
			localeValue: "{count, plural, one {Artikel} other {Artikel}}",
			wantErrors:  1, // missing =0
		},
		{
			name:        "extra branch",
			enValue:     "{count, plural, one {item} other {items}}",
			localeValue: "{count, plural, =0 {keine} one {Artikel} other {Artikel}}",
			wantErrors:  1, // unexpected =0
		},
		{
			name:        "no ICU in either",
			enValue:     "Simple text",
			localeValue: "Einfacher Text",
			wantErrors:  0,
		},
		{
			name:        "nested plural",
			enValue:     "{pages, plural, =0 {No entries} =1 {{count} {count, plural, =1 {Item} other {Items}}} other {{from} - {to} of {count}}}",
			localeValue: "{pages, plural, =0 {Keine Einträge} =1 {{count} {count, plural, =1 {Eintrag} other {Einträge}}} other {{from} - {to} von {count}}}",
			wantErrors:  0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errs := checkICUStructure("test.key", mustParseICU(t, tc.enValue), mustParseICU(t, tc.localeValue))
			if len(errs) != tc.wantErrors {
				t.Errorf("got %d errors, want %d: %v", len(errs), tc.wantErrors, errs)
			}
		})
	}
}

func TestCheckICUSyntax(t *testing.T) {
	tests := []struct {
		name        string
		enValue     string
		localeValue string
		wantErrors  int
		wantCheck   string
	}{
		{
			name:        "balanced both sides",
			enValue:     "Hello {name}",
			localeValue: "Hallo {name}",
			wantErrors:  0,
		},
		{
			name:        "unbalanced brace in locale",
			enValue:     "Hello {name}",
			localeValue: "Hallo {name",
			wantErrors:  1,
			wantCheck:   "icu-syntax",
		},
		{
			name:        "unbalanced brace in source",
			enValue:     "Hello {name",
			localeValue: "Hallo {name}",
			wantErrors:  1,
			wantCheck:   "icu-syntax",
		},
		{
			name:        "no ICU in either",
			enValue:     "plain text",
			localeValue: "einfacher Text",
			wantErrors:  0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errs := checkICU("test.key", tc.enValue, tc.localeValue)
			if len(errs) != tc.wantErrors {
				t.Errorf("got %d errors, want %d: %v", len(errs), tc.wantErrors, errs)
				return
			}
			if tc.wantCheck != "" && errs[0].Check != tc.wantCheck {
				t.Errorf("check = %q, want %q", errs[0].Check, tc.wantCheck)
			}
		})
	}
}

func TestExtractTagNames(t *testing.T) {
	tests := []struct {
		input string
		want  map[string]int
	}{
		{"<b>text</b>", map[string]int{"b": 2}},
		{"<a href='x'>link</a>", map[string]int{"a": 2}},
		{"<br/>", map[string]int{"br": 1}},
		{"<code>x</code> and <b>y</b>", map[string]int{"code": 2, "b": 2}},
		{"no tags", map[string]int{}},
		{"<B>text</B>", map[string]int{"b": 2}},
		{"<b>x</b> and <B>y</B>", map[string]int{"b": 4}},
		{"<BR/>", map[string]int{"br": 1}},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := extractTagNames(tc.input)
			if len(got) != len(tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
				return
			}
			for k, wantCount := range tc.want {
				if got[k] != wantCount {
					t.Errorf("tag %q: got %d, want %d", k, got[k], wantCount)
				}
			}
		})
	}
}

func TestValidateLocaleEndToEnd(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(translationsPath(root, "en-us.yaml")), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(locale, content string) {
		if err := os.WriteFile(translationsPath(root, locale+".yaml"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("en-us", "greeting: Hello {name}\nfarewell: Bye\n")
	// Valid: placeholder preserved, both keys carry @source.
	write("ok", "# @source Hello {name}\ngreeting: Hallo {name}\n# @source Bye\nfarewell: Tschüss\n")
	// Broken: greeting drops {name}, farewell has no @source.
	write("bad", "# @source Hello {name}\ngreeting: Hallo\nfarewell: Tschüss\n")

	if errs, err := validateLocale(root, "ok"); err != nil || len(errs) != 0 {
		t.Fatalf("ok locale: err=%v, errors=%v", err, errs)
	}

	errs, err := validateLocale(root, "bad")
	if err != nil {
		t.Fatalf("bad locale: unexpected err %v", err)
	}
	got := map[string]int{}
	for _, e := range errs {
		got[e.Check]++
	}
	if got[catPlaceholder] != 1 || got[catSource] != 1 {
		t.Fatalf("bad locale: want 1 placeholder + 1 source, got %v: %v", got, errs)
	}
}

func TestValidateIdenticalNeedsReason(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(translationsPath(root, "en-us.yaml")), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(locale, content string) {
		t.Helper()
		if err := os.WriteFile(translationsPath(root, locale+".yaml"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("en-us", `title: Volumes
farewell: Bye
empty: ""
renamed: Current
moved: Updated
secret:
  types:
    kubernetes.io/basic-auth: Opaque
`)
	// Identical values that are deliberate (@reason or @override), translated
	// values, and empty values produce no findings. The check also skips two
	// kinds of key the drift check owns, whose @source no longer matches the
	// current English: one already retranslated, one still matching its stale
	// snapshot. A key absent from en-us belongs to the stale check. Removing the
	// !inEn guard leaves this fixture green: the stale-snapshot comparison
	// skips the key too.
	write("annotated", `# @reason standard term in this language
# @source Volumes
title: Volumes
# @source Bye
farewell: Tschüss
# @source
empty: ""
# @source Superseded
renamed: Current
# @source Original
moved: Original
# @source Gone
withdrawn: Gone
secret:
  types:
    # @override
    # @source Opaque
    kubernetes.io/basic-auth: Opaque
`)
	// Identical values with only a @source are flagged, including keys whose
	// segments need quoting in the dotted representation.
	write("bare", `# @source Volumes
title: Volumes
# @source Bye
farewell: Tschüss
# @source
empty: ""
secret:
  types:
    # @source Opaque
    kubernetes.io/basic-auth: Opaque
`)

	identical := func(locale string) []string {
		t.Helper()
		errs, err := validateLocale(root, locale)
		if err != nil {
			t.Fatalf("%s locale: unexpected err %v", locale, err)
		}
		var keys []string
		for _, e := range errs {
			if e.Check == catIdentical {
				keys = append(keys, e.Key)
			}
		}
		return keys
	}

	if keys := identical("annotated"); len(keys) != 0 {
		t.Errorf("annotated locale: want no identical findings, got %v", keys)
	}
	want := []string{`secret.types."kubernetes.io/basic-auth"`, "title"}
	if keys := identical("bare"); !slices.Equal(keys, want) {
		t.Errorf("bare locale: want identical findings %v, got %v", want, keys)
	}
}
