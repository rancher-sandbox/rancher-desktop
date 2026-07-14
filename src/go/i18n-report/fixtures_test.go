// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

// bootstrapSource records @source snapshots on de.yaml, as `source` would.
func bootstrapSource(t *testing.T, dir string) {
	t.Helper()
	if err := annotateSource(io.Discard, dir, "de", false); err != nil {
		t.Fatal(err)
	}
}

// setupLocaleTestRepo builds a repo fixture with en-us.yaml and de.yaml. When
// withSource is set, de.yaml is annotated with @source snapshots of the current
// English, as a real bootstrap would leave it.
func setupLocaleTestRepo(t *testing.T, enUS, locale string, withSource bool) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0o644)

	if withSource {
		bootstrapSource(t, dir)
	}
	return dir
}
