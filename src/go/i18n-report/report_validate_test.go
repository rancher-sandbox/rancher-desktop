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

func TestExtractICUConstructs(t *testing.T) {
	tests := []struct {
		input    string
		wantLen  int
		wantVar  string
		wantKw   string
		wantBr   []string
	}{
		{
			input:   "{count, plural, one {item} other {items}}",
			wantLen: 1, wantVar: "count", wantKw: "plural",
			wantBr: []string{"one", "other"},
		},
		{
			input:   "{count, plural, =0 {none} =1 {one} other {many}}",
			wantLen: 1, wantVar: "count", wantKw: "plural",
			wantBr: []string{"=0", "=1", "other"},
		},
		{
			input:   "no ICU here",
			wantLen: 0,
		},
		{
			input:   "{name} is just a placeholder",
			wantLen: 0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := extractICUConstructs(tc.input)
			if len(got) != tc.wantLen {
				t.Errorf("got %d constructs, want %d: %+v", len(got), tc.wantLen, got)
				return
			}
			if tc.wantLen > 0 {
				c := got[0]
				if c.Variable != tc.wantVar {
					t.Errorf("variable = %q, want %q", c.Variable, tc.wantVar)
				}
				if c.Keyword != tc.wantKw {
					t.Errorf("keyword = %q, want %q", c.Keyword, tc.wantKw)
				}
				if len(c.Branches) != len(tc.wantBr) {
					t.Errorf("branches = %v, want %v", c.Branches, tc.wantBr)
				} else {
					for i, b := range tc.wantBr {
						if c.Branches[i] != b {
							t.Errorf("branch[%d] = %q, want %q", i, c.Branches[i], b)
						}
					}
				}
			}
		})
	}
}

func TestExtractPlaceholderNames(t *testing.T) {
	tests := []struct {
		input string
		want  map[string]bool
	}{
		{"Hello {name}", map[string]bool{"name": true}},
		{"{count, plural, one {item} other {items}}", map[string]bool{"count": true}},
		{"no placeholders", map[string]bool{}},
		{"{ action }ing image", map[string]bool{"action": true}},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := extractPlaceholderNames(tc.input)
			if len(got) != len(tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
				return
			}
			for k := range tc.want {
				if !got[k] {
					t.Errorf("missing placeholder %q in result %v", k, got)
				}
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
