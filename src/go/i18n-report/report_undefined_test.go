// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestFindUndefinedKeys(t *testing.T) {
	source := `<template>
  <sortable-table no-rows-key="table.missingNoRows" />
  <span v-t="'menu.missingAction'" />
</template>
<script>
export default {
  data() {
    return {
      // Indirect reference to a missing key: must NOT be reported,
      // because the indirect pattern also matches settings paths.
      barKey: 'settings.some.path',
    };
  },
  computed: {
    label() {
      return this.t('defined.key');
    },
  },
};
</script>
`
	dir := setupScanTestRepo(t, source)
	keys := map[string]string{"defined.key": "Defined"}

	undefined, err := findUndefinedKeys(dir, keys)
	if err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"table.missingNoRows", "menu.missingAction"} {
		if len(undefined[key]) == 0 {
			t.Errorf("expected %q to be reported as undefined", key)
		}
	}
	if len(undefined["defined.key"]) != 0 {
		t.Error("defined key must not be reported as undefined")
	}
	if len(undefined["settings.some.path"]) != 0 {
		t.Error("indirect reference to a missing key must not be reported")
	}
}

func TestReportUndefinedFindingsError(t *testing.T) {
	source := "<template>\n  <span v-t=\"'menu.missingAction'\" />\n</template>\n"
	dir := setupScanTestRepo(t, source)
	writeTranslations(t, dir, "defined:\n  key: Defined\n")

	var buf bytes.Buffer
	err := reportUndefined(&buf, dir, formatText)
	if err == nil {
		t.Fatal("expected a findings error")
	}
	if !errors.Is(err, errFindings) {
		t.Errorf("expected errors.Is(err, errFindings), got %v", err)
	}
	if strings.Contains(err.Error(), "findings") {
		t.Errorf("sentinel text leaked into the message: %q", err.Error())
	}
}
