// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

// Shared key-set computations. The listers (stale, missing, translate) all
// derive their findings from these helpers.

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
