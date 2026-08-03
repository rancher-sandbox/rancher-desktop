// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestReportDynamicJSONListsAreNeverNull(t *testing.T) {
	source := "<script>\n" +
		"export default {\n" +
		"  computed: {\n" +
		"    label() {\n" +
		"      return this.t(`unmatched.${ this.kind }.label`);\n" +
		"    },\n" +
		"  },\n" +
		"};\n" +
		"</script>\n"
	dir := setupScanTestRepo(t, source)
	writeTranslations(t, dir, "generic:\n  known: Known\n")

	var buf bytes.Buffer
	if err := reportDynamic(&buf, dir, formatJSON); err != nil {
		t.Fatal(err)
	}

	var entries []struct {
		Pattern string   `json:"pattern"`
		Matches []string `json:"matches"`
	}
	if err := json.Unmarshal(buf.Bytes(), &entries); err != nil {
		t.Fatalf("invalid JSON output: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one dynamic pattern, got %d", len(entries))
	}
	if entries[0].Matches == nil {
		t.Error(`expected "matches" to serialize as [], not null`)
	}
}

func TestReportDynamicJSONEmptyReport(t *testing.T) {
	dir := setupScanTestRepo(t, "<template>\n  <div />\n</template>\n")
	writeTranslations(t, dir, "generic:\n  known: Known\n")

	var buf bytes.Buffer
	if err := reportDynamic(&buf, dir, formatJSON); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(buf.String()); got != "[]" {
		t.Errorf("empty report encoded as %q, want []", got)
	}
}
