// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"os"
	"testing"
)

func TestCommentHasOverride(t *testing.T) {
	tests := []struct {
		comment string
		want    bool
	}{
		{"# @override", true},
		{"# @override human-reviewed translation", true},
		{"# @reason standard term\n# @override", true},
		{"# @override\n# @reason something", true},
		{"# @reason no override here", false},
		{"", false},
		{"# @overridden", false}, // not an exact prefix match
	}
	for _, tc := range tests {
		got := commentHasOverride(tc.comment)
		if got != tc.want {
			t.Errorf("commentHasOverride(%q) = %v, want %v", tc.comment, got, tc.want)
		}
	}
}

func TestLoadYAMLWithCommentsOverride(t *testing.T) {
	input := `status:
  # @override
  checking: Checking...
  # @reason standard term
  updating: Updating...
`
	tmpFile := t.TempDir() + "/test.yaml"
	os.WriteFile(tmpFile, []byte(input), 0644)
	got, err := loadYAMLWithComments(tmpFile)
	if err != nil {
		t.Fatal(err)
	}

	if !got["status.checking"].override {
		t.Error("status.checking should have override=true")
	}
	if got["status.updating"].override {
		t.Error("status.updating should not have override=true")
	}
}

func TestLoadYAMLWithComments(t *testing.T) {
	// Write a temp YAML file with comments and load it.
	input := `status:
  # @reason "checking" = standard term
  versionChecking: Checking...
  # @reason multi-line reason;
  #   continued here
  updating: Updating...
  noComment: plain value
locale:
  name: English
`
	tmpFile := t.TempDir() + "/test.yaml"
	if err := os.WriteFile(tmpFile, []byte(input), 0644); err != nil {
		t.Fatal(err)
	}
	got, err := loadYAMLWithComments(tmpFile)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		key     string
		value   string
		comment string
	}{
		{"status.versionChecking", "Checking...", "# @reason \"checking\" = standard term"},
		{"status.updating", "Updating...", "# @reason multi-line reason;\n#   continued here"},
		{"status.noComment", "plain value", ""},
		{"locale.name", "English", ""},
	}
	for _, tc := range tests {
		e, ok := got[tc.key]
		if !ok {
			t.Errorf("missing key %q", tc.key)
			continue
		}
		if e.value != tc.value {
			t.Errorf("key %q: value = %q, want %q", tc.key, e.value, tc.value)
		}
		if e.comment != tc.comment {
			t.Errorf("key %q: comment = %q, want %q", tc.key, e.comment, tc.comment)
		}
	}
}
