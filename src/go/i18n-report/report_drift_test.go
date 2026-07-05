// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDriftFindingsVsOperationalError(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupDriftTestRepo(t, enUS, de)
	generateMetadata(dir, "de")

	// Drift the English so reportDrift reports a finding.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n"), 0o644)

	findErr := reportDrift(io.Discard, dir, "de")
	if !errors.Is(findErr, errFindings) {
		t.Errorf("drift finding should wrap errFindings, got: %v", findErr)
	}

	// An unreadable locale file is operational, not a finding.
	dir2 := setupDriftTestRepo(t, enUS, "")
	os.Remove(filepath.Join(dir2, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))
	opErr := reportDrift(io.Discard, dir2, "de")
	if opErr == nil {
		t.Fatal("expected an operational error for a missing locale file")
	}
	if errors.Is(opErr, errFindings) {
		t.Errorf("missing-file error must not be a findings error: %v", opErr)
	}
}

func setupDriftTestRepo(t *testing.T, enUS, locale string) string {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0o755)
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0o644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(locale), 0o644)
	return dir
}

func TestDriftDetectsChangedEnglish(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupDriftTestRepo(t, enUS, de)

	// Generate metadata with current English.
	generateMetadata(dir, "de")

	// Change English text for "checking".
	newEnUS := "status:\n  checking: Verifying...\n  done: Done\n"
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(newEnUS), 0o644)

	var buf bytes.Buffer
	if err := reportDrift(&buf, dir, "de"); err == nil {
		t.Fatal("expected non-nil error when drift is detected")
	}
	output := buf.String()

	if !strings.Contains(output, "status.checking") {
		t.Errorf("expected drifted key status.checking in output:\n%s", output)
	}
	// "done" did not change, should not appear.
	if strings.Contains(output, "status.done") {
		t.Errorf("status.done should not be drifted:\n%s", output)
	}
}

func TestDriftNoDrift(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  checking: Wird geprüft…\n"
	dir := setupDriftTestRepo(t, enUS, de)

	generateMetadata(dir, "de")

	var buf bytes.Buffer
	if err := reportDrift(&buf, dir, "de"); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(buf.String(), "No drift detected") {
		t.Errorf("expected no drift, got:\n%s", buf.String())
	}
}

func TestDriftFlagsOverride(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	de := "status:\n  # @override\n  checking: Manuelle Übersetzung\n"
	dir := setupDriftTestRepo(t, enUS, de)

	generateMetadata(dir, "de")

	// Change English.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte("status:\n  checking: Verifying...\n"), 0o644)

	var buf bytes.Buffer
	reportDrift(&buf, dir, "de")
	output := buf.String()

	if !strings.Contains(output, "(@override)") {
		t.Errorf("expected @override flag in drift output:\n%s", output)
	}
}

func TestDriftMissingLocaleFile(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n"
	dir := setupDriftTestRepo(t, enUS, "")

	// Remove the locale file so only en-us exists.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.Remove(filepath.Join(transDir, "de.yaml"))

	err := reportDrift(io.Discard, dir, "de")
	if err == nil {
		t.Fatal("expected error for missing locale file")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected 'not found' error, got: %v", err)
	}
}

func TestDriftMissingMetadata(t *testing.T) {
	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	de := "status:\n  checking: Wird geprüft…\n  done: Fertig\n"
	dir := setupDriftTestRepo(t, enUS, de)

	// No metadata generated — both keys should report as missing metadata.
	var buf bytes.Buffer
	reportDrift(&buf, dir, "de")

	if !strings.Contains(buf.String(), "missing metadata") {
		t.Errorf("expected missing metadata warning:\n%s", buf.String())
	}
}
