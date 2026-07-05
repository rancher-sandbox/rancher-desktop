// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"os"
	"path/filepath"
	"testing"
)

// setupLocaleTestRepo builds a repo fixture with en-us.yaml, de.yaml, and
// (optionally) generated metadata for de.
func setupLocaleTestRepo(t *testing.T, enUS, locale string, withMeta bool) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0o644)

	if withMeta {
		generateMetadata(dir, "de")
	}
	return dir
}
