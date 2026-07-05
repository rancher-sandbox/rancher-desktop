// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func driftEnUS(t *testing.T, dir, content string) {
	t.Helper()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	if err := os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestMetaGuardBlocksOutstandingDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	// withMeta=true snapshots the current English into meta/de.yaml.
	dir := setupLocaleTestRepo(t, enUS, de, true)

	// Drift the English after the metadata snapshot.
	driftEnUS(t, dir, "status:\n  checking: Verifying...\n")

	err := regenerateMetadata(io.Discard, dir, "de", false)
	if !errors.Is(err, errFindings) {
		t.Fatalf("expected a findings error for outstanding drift, got: %v", err)
	}

	// Metadata must be untouched so the drift marker survives.
	meta, _ := loadMetadata(dir, "de")
	if meta["status.checking"] != "Checking..." {
		t.Errorf("metadata overwritten despite drift: got %q", meta["status.checking"])
	}
}

func TestMetaForceOverwritesDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	driftEnUS(t, dir, "status:\n  checking: Verifying...\n")

	if err := regenerateMetadata(io.Discard, dir, "de", true); err != nil {
		t.Fatalf("--force should regenerate despite drift, got: %v", err)
	}
	meta, _ := loadMetadata(dir, "de")
	if meta["status.checking"] != "Verifying..." {
		t.Errorf("--force did not refresh metadata: got %q", meta["status.checking"])
	}
}

func TestMetaBootstrapIgnoresGuard(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	// withMeta=false: no metadata file exists yet.
	dir := setupLocaleTestRepo(t, enUS, de, false)

	if err := regenerateMetadata(io.Discard, dir, "de", false); err != nil {
		t.Fatalf("bootstrap should succeed without --force, got: %v", err)
	}
	if _, err := os.Stat(metadataPath(dir, "de")); err != nil {
		t.Errorf("bootstrap did not create metadata file: %v", err)
	}
}
