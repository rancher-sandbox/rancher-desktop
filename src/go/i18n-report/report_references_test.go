// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeTranslations writes an en-us.yaml into the temp repo so report
// commands can load it.
func writeTranslations(t *testing.T, dir, content string) {
	t.Helper()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	if err := os.MkdirAll(transDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestReportReferencesJSONOmitsUndefinedKeys(t *testing.T) {
	source := `<script>
export default {
  computed: {
    label() {
      return this.t('generic.known') + this.t('generic.missing');
    },
  },
};
</script>
`
	dir := setupScanTestRepo(t, source)
	writeTranslations(t, dir, "generic:\n  known: Known\n")

	var buf bytes.Buffer
	if err := reportReferences(&buf, dir, formatJSON); err != nil {
		t.Fatal(err)
	}

	var refs map[string][]keyReference
	if err := json.Unmarshal(buf.Bytes(), &refs); err != nil {
		t.Fatalf("invalid JSON output: %v", err)
	}
	if len(refs["generic.known"]) == 0 {
		t.Error("expected generic.known to be reported with its references")
	}
	if _, found := refs["generic.missing"]; found {
		t.Error("JSON output must only contain keys defined in en-us.yaml, like text output")
	}
}
