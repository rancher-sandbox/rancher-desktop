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
	if err := outputStrings(&buf, nil, "json", "unused keys"); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(buf.String()); got != "[]" {
		t.Errorf("empty list encoded as %q, want []", got)
	}
}
