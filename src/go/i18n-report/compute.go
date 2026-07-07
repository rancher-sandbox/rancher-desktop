// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

// Shared key-set computations.

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
