// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"strings"
	"testing"
)

func TestValidateFormat(t *testing.T) {
	for _, format := range []string{formatText, formatJSON} {
		if err := validateFormat(format); err != nil {
			t.Errorf("validateFormat(%q) = %v, want nil", format, err)
		}
	}
	if err := validateFormat("bogus"); err == nil {
		t.Error("expected an error for an unsupported format")
	}
}

func TestOutputStringsEmptyJSON(t *testing.T) {
	var buf strings.Builder
	if err := outputStrings(&buf, nil, "json", "unused key", ""); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(buf.String()); got != "[]" {
		t.Errorf("empty list encoded as %q, want []", got)
	}
}

func TestPlural(t *testing.T) {
	for _, c := range []struct {
		n    int
		want string
	}{{0, "keys"}, {1, "key"}, {2, "keys"}} {
		if got := plural(c.n, "key"); got != c.want {
			t.Errorf("plural(%d, \"key\") = %q, want %q", c.n, got, c.want)
		}
	}
}

func TestOutputStringsTextPluralizes(t *testing.T) {
	for _, c := range []struct {
		name         string
		items        []string
		noun, suffix string
		want         string
	}{
		{"zero", nil, "unused key", "", "No unused keys found.\n"},
		{"zero suffix", nil, "stale key", " in de", "No stale keys found in de.\n"},
		{"one", []string{"a.b"}, "unused key", "", "Found 1 unused key:\n  a.b\n"},
		{"many", []string{"a.b", "c.d"}, "unused key", "", "Found 2 unused keys:\n  a.b\n  c.d\n"},
		{"suffix", []string{"a.b"}, "stale key", " in de", "Found 1 stale key in de:\n  a.b\n"},
	} {
		t.Run(c.name, func(t *testing.T) {
			var buf strings.Builder
			if err := outputStrings(&buf, c.items, formatText, c.noun, c.suffix); err != nil {
				t.Fatal(err)
			}
			if got := buf.String(); got != c.want {
				t.Errorf("outputStrings = %q, want %q", got, c.want)
			}
		})
	}
}
