// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"io"
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
