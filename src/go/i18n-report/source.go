// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// sourceMarker records the English text a translation was made from. It lives
// in the translated key's comment, so the snapshot travels with the
// translation and a later drift check needs no parallel file.
const sourceMarker = "# @source"

// sourceFromComment extracts the English snapshot from a key's HeadComment.
// A multi-line source repeats the marker, one physical line each, and the
// lines rejoin in order. Returns false when the key carries no @source.
func sourceFromComment(comment string) (string, bool) {
	var lines []string
	found := false
	for _, line := range strings.Split(comment, "\n") {
		// Strip only indentation; a value's own trailing spaces must survive.
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == sourceMarker {
			lines = append(lines, "")
			found = true
		} else if rest, ok := strings.CutPrefix(trimmed, sourceMarker+" "); ok {
			lines = append(lines, rest)
			found = true
		}
	}
	if !found {
		return "", false
	}
	return strings.Join(lines, "\n"), true
}

// setSourceComment replaces a comment's @source lines with english, preserving
// every other line (e.g. @override, @reason) and its order. The fresh @source
// lines follow, one per physical line of the English text.
func setSourceComment(comment, english string) string {
	var kept []string
	for _, line := range strings.Split(comment, "\n") {
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == "" || trimmed == sourceMarker || strings.HasPrefix(trimmed, sourceMarker+" ") {
			continue
		}
		kept = append(kept, line)
	}
	for _, l := range strings.Split(english, "\n") {
		if l == "" {
			kept = append(kept, sourceMarker)
		} else {
			kept = append(kept, sourceMarker+" "+l)
		}
	}
	return strings.Join(kept, "\n")
}

// collectSources maps each key that carries an @source comment to its snapshot.
func collectSources(entries map[string]mergeEntry) map[string]string {
	sources := make(map[string]string)
	for key, e := range entries {
		if src, ok := sourceFromComment(e.comment); ok {
			sources[key] = src
		}
	}
	return sources
}

// loadSources reads a locale file and returns each key's @source snapshot,
// the co-located replacement for a parallel metadata file.
func loadSources(root, locale string) (map[string]string, error) {
	entries, err := loadYAMLWithComments(translationsPath(root, locale+".yaml"))
	if err != nil {
		return nil, err
	}
	return collectSources(entries), nil
}

// annotateNodeSource walks the mapping tree and sets @source on every leaf key
// whose dotted path exists in enKeys, to the current English value. It mutates
// the visited key node's HeadComment directly, so keys whose own segments
// contain dots are annotated correctly without re-splitting a dotted path.
func annotateNodeSource(prefix string, node *yaml.Node, enKeys map[string]string) {
	if node.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i < len(node.Content)-1; i += 2 {
		keyNode := node.Content[i]
		valNode := node.Content[i+1]
		key := keyNode.Value
		if prefix != "" {
			key = prefix + "." + key
		}
		if valNode.Kind == yaml.MappingNode {
			annotateNodeSource(key, valNode, enKeys)
		} else if english, ok := enKeys[key]; ok {
			keyNode.HeadComment = setSourceComment(keyNode.HeadComment, english)
		}
	}
}
