// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestParseICUArgumentNames(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "simple placeholder",
			input: "Hello {name}",
			want:  []string{"name"},
		},
		{
			name:  "spaced placeholder",
			input: "Error { action } failed",
			want:  []string{"action"},
		},
		{
			name:  "typed argument",
			input: "{count, number}",
			want:  []string{"count"},
		},
		{
			name:  "plural variable and pound",
			input: "{count, plural, one {# item} other {# items}}",
			want:  []string{"count"},
		},
		{
			name:  "nested plural extracts inner placeholders",
			input: "{pages, plural, =0 {No entries} =1 {{count} {count, plural, =1 {Item} other {Items}}} other {{from} - {to} of {count}}}",
			want:  []string{"count", "from", "pages", "to"},
		},
		{
			name:  "apostrophe-wrapped placeholder",
			input: "''{version}''",
			want:  []string{"version"},
		},
		{
			name:  "fully quoted extracts nothing",
			input: "'{version}'",
			want:  nil,
		},
		{
			name:  "quoted tags around placeholder",
			input: "Created on '<b>'{date}'</b>' at '<b>'{time}'</b>'",
			want:  []string{"date", "time"},
		},
		{
			name:  "no placeholders",
			input: "just plain text",
			want:  nil,
		},
		{
			name:  "lone apostrophe is literal",
			input: "QEMU's {device} devices",
			want:  []string{"device"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			nodes, err := parseICU(tc.input)
			if err != nil {
				t.Fatalf("parseICU(%q) failed: %v", tc.input, err)
			}
			got := sortedKeys(icuArgumentNames(nodes))
			want := append([]string{}, tc.want...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("argument names = %v, want %v", got, want)
			}
		})
	}
}

func TestParseICUErrors(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"unterminated argument", "Hello {name"},
		{"stray close brace", "Hello }"},
		{"unterminated plural", "{count, plural, one {item}"},
		{"missing branch body", "{count, plural, one other {x}}"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseICU(tc.input); err == nil {
				t.Errorf("parseICU(%q) = nil error, want error", tc.input)
			}
		})
	}
}

func TestParseICUConstructs(t *testing.T) {
	nodes, err := parseICU("{count, plural, =0 {none} one {item} other {items}}")
	if err != nil {
		t.Fatalf("parseICU failed: %v", err)
	}
	got := icuConstructs(nodes)
	if len(got) != 1 {
		t.Fatalf("got %d constructs, want 1: %+v", len(got), got)
	}
	c := got[0]
	if c.Variable != "count" || c.Keyword != "plural" {
		t.Errorf("construct = {%s, %s}, want {count, plural}", c.Variable, c.Keyword)
	}
	if !reflect.DeepEqual(c.Branches, []string{"=0", "one", "other"}) {
		t.Errorf("branches = %v, want [=0 one other]", c.Branches)
	}
}

func TestParseICUNestedConstructs(t *testing.T) {
	input := "{pages, plural, =1 {{count, plural, =1 {Item} other {Items}}} other {none}}"
	nodes, err := parseICU(input)
	if err != nil {
		t.Fatalf("parseICU failed: %v", err)
	}
	got := icuConstructs(nodes)
	if len(got) != 1 || got[0].Variable != "pages" {
		t.Fatalf("top-level construct = %+v, want single pages construct", got)
	}
	if len(got[0].Nested) != 1 || got[0].Nested[0].Variable != "count" {
		t.Errorf("nested construct = %+v, want single count construct", got[0].Nested)
	}
}

// TestParseICURealCorpus parses every value in the real en-us.yaml. The runtime
// (intl-messageformat 11) accepts all of them, so the parser must too.
func TestParseICURealCorpus(t *testing.T) {
	root, err := repoRoot()
	if err != nil {
		t.Skipf("repoRoot: %v", err)
	}
	path := filepath.Join(root, "pkg", "rancher-desktop", "assets", "translations", "en-us.yaml")
	values, err := loadYAMLFlat(path)
	if err != nil {
		t.Fatalf("loadYAMLFlat(%s): %v", path, err)
	}
	if len(values) < 500 {
		t.Fatalf("loaded only %d values from en-us.yaml, expected the full corpus", len(values))
	}
	for key, value := range values {
		if _, err := parseICU(value); err != nil {
			t.Errorf("parseICU failed for %s = %q: %v", key, value, err)
		}
	}
}
