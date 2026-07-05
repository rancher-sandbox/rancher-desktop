// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"errors"
	"io"
	"os"
	"testing"
)

func driftEnUS(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(translationsPath(dir, "en-us.yaml"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSourceGuardBlocksOutstandingDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	// withSource=true records @source: Checking... on the translated key.
	dir := setupLocaleTestRepo(t, enUS, de, true)

	// The English moves on after the snapshot.
	driftEnUS(t, dir, "status:\n  checking: Verifying...\n")

	if err := annotateSource(io.Discard, dir, "de", false); !errors.Is(err, errFindings) {
		t.Fatalf("expected a findings error for outstanding drift, got: %v", err)
	}
	// The @source must survive so the drift marker is not erased.
	if got, _ := sourceOf(t, dir, "status.checking"); got != "Checking..." {
		t.Errorf("@source overwritten despite drift: got %q", got)
	}
}

func TestSourceForceOverwritesDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, true)

	driftEnUS(t, dir, "status:\n  checking: Verifying...\n")

	if err := annotateSource(io.Discard, dir, "de", true); err != nil {
		t.Fatalf("--force should annotate despite drift, got: %v", err)
	}
	if got, _ := sourceOf(t, dir, "status.checking"); got != "Verifying..." {
		t.Errorf("--force did not refresh @source: got %q", got)
	}
}

func TestSourceBootstrapIgnoresGuard(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	// withSource=false: no @source recorded yet.
	dir := setupLocaleTestRepo(t, enUS, de, false)

	if err := annotateSource(io.Discard, dir, "de", false); err != nil {
		t.Fatalf("bootstrap should succeed without --force, got: %v", err)
	}
	if got, ok := sourceOf(t, dir, "status.checking"); !ok || got != "Checking..." {
		t.Errorf("bootstrap did not record @source: got (%q, %v)", got, ok)
	}
}

func TestSourceRejectsNonMappingFile(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "just a scalar\n"
	dir := setupLocaleTestRepo(t, enUS, de, false)

	if err := annotateSource(io.Discard, dir, "de", false); err == nil {
		t.Fatal("expected an error for a non-mapping locale file")
	}
	data, err := os.ReadFile(translationsPath(dir, "de.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != de {
		t.Errorf("locale file rewritten: got %q, want %q", data, de)
	}
}

func TestSourceForceRequiresLocaleFile(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupLocaleTestRepo(t, enUS, de, false)

	if err := annotateSource(io.Discard, dir, "xx", true); err == nil {
		t.Fatal("expected an error for a missing locale file")
	}
	if _, err := os.Stat(translationsPath(dir, "xx.yaml")); !os.IsNotExist(err) {
		t.Errorf("xx.yaml should not be created, stat: %v", err)
	}
}
