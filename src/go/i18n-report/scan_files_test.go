// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// setupScanTestRepo creates a temp repo containing a single Vue component
// exercising the scanner's file-level behavior.
func setupScanTestRepo(t *testing.T, source string) string {
	t.Helper()
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "pkg", "rancher-desktop", "components")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "Sample.vue"), []byte(source), 0644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestScanFilesAttributeAndMultilineForms(t *testing.T) {
	source := `<template>
  <sortable-table
    no-rows-key="table.noRows"
  />
  <t
    k="generic.loading"
    :raw="true"
  />
  <span v-t="'menu.noActions'" />
</template>
<script>
export default {
  computed: {
    body() {
      return this.t(
        'extensions.body',
        { id: this.id },
        true,
      );
    },
  },
};
// t('commented.key') must not count as a reference
</script>
`
	dir := setupScanTestRepo(t, source)
	keys := map[string]string{
		"table.noRows":    "There are no rows",
		"generic.loading": "Loading",
		"menu.noActions":  "No actions",
		"extensions.body": "Body text",
		"commented.key":   "Commented out",
	}

	refs, err := findKeyReferences(dir, keys)
	if err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"table.noRows", "generic.loading", "menu.noActions", "extensions.body"} {
		if len(refs[key]) == 0 {
			t.Errorf("expected %q to be referenced, scanner missed it", key)
		}
	}
	if len(refs["commented.key"]) != 0 {
		t.Errorf("expected commented-out key to be ignored, got refs %v", refs["commented.key"])
	}
}

func TestScanFilesDynamicPatternMarksKeysReferenced(t *testing.T) {
	source := "<script>\n" +
		"export default {\n" +
		"  computed: {\n" +
		"    label() {\n" +
		"      return this.t(`prefix.${ this.kind }.label`);\n" +
		"    },\n" +
		"  },\n" +
		"};\n" +
		"</script>\n"
	dir := setupScanTestRepo(t, source)
	keys := map[string]string{
		"prefix.a.label": "A",
		"other.key":      "Other",
	}

	refs, err := findKeyReferences(dir, keys)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs["prefix.a.label"]) == 0 {
		t.Error("expected dynamically matched key to be marked as referenced")
	}
	if len(refs["other.key"]) != 0 {
		t.Errorf("expected unmatched key to have no references, got %v", refs["other.key"])
	}
}

func TestScanFilesUnreadableFileIsAnError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file modes cannot make a file unreadable on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("root can read mode-0 files")
	}
	dir := setupScanTestRepo(t, "<template>\n  <div />\n</template>\n")
	broken := filepath.Join(dir, "pkg", "rancher-desktop", "components", "Broken.vue")
	if err := os.WriteFile(broken, []byte("t('some.key')\n"), 0); err != nil {
		t.Fatal(err)
	}

	if _, err := findKeyReferences(dir, nil); err == nil {
		t.Error("expected an error for an unreadable source file")
	}
}
