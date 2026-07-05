// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"testing"
)

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
			errs := checkPlaceholders("test.key", tc.enValue, tc.localeValue)
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
			errs := checkICUStructure("test.key", tc.enValue, tc.localeValue)
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
