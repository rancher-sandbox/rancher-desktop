// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

// Shared key-set computations. The gate commands (check, drift) and the
// listers (stale, missing, translate) all derive their findings from these
// helpers, so a gate and its matching lister agree by construction.
//
// Drift compares the current en-us value against the @source snapshot recorded
// at translation time; both are decoded scalars, so re-quoting the English
// never counts as drift.

// computeStale returns locale keys that no longer exist in en-us, sorted.
func computeStale[V any](enKeys map[string]string, localeKeys map[string]V) []string {
	var stale []string
	for _, k := range sortedKeys(localeKeys) {
		if _, found := enKeys[k]; !found {
			stale = append(stale, k)
		}
	}
	return stale
}

// computeMissing returns en-us keys absent from the locale, sorted.
func computeMissing[V any](enKeys map[string]string, localeKeys map[string]V) []string {
	var missing []string
	for _, k := range sortedKeys(enKeys) {
		if _, found := localeKeys[k]; !found {
			missing = append(missing, k)
		}
	}
	return missing
}

// computeDrifted returns keys whose English source differs from the @source
// snapshot, sorted. Only keys present in the locale, en-us, and with a @source
// are considered; a key without a @source cannot be checked for drift.
func computeDrifted[V any](enKeys, meta map[string]string, localeKeys map[string]V) []string {
	var drifted []string
	for _, k := range sortedKeys(localeKeys) {
		enValue, inEn := enKeys[k]
		storedSource, inMeta := meta[k]
		if !inEn || !inMeta {
			continue
		}
		if enValue != storedSource {
			drifted = append(drifted, k)
		}
	}
	return drifted
}
