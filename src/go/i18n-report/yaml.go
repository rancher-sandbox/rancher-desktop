// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// loadYAMLFlat loads a YAML file and returns flattened key-value pairs.
// Values are the raw scalar text as written, with no YAML type resolution,
// so every consumer sees the same string the translation file contains.
func loadYAMLFlat(path string) (map[string]string, error) {
	entries, err := loadYAMLWithComments(path)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(entries))
	for k, e := range entries {
		result[k] = e.value
	}
	return result, nil
}

// mergeEntry holds a translated key-value pair with an optional comment.
type mergeEntry struct {
	key      string
	value    string
	comment  string // may be multi-line (joined with "\n")
	override bool   // true if comment contains @override
}

// loadYAMLWithComments loads a YAML file and returns flattened entries
// that preserve YAML comments (e.g. @reason, @context annotations).
func loadYAMLWithComments(path string) (map[string]mergeEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	result := make(map[string]mergeEntry)
	if doc.Kind == yaml.DocumentNode && len(doc.Content) > 0 {
		flattenNodeWithComments("", doc.Content[0], result)
	}
	return result, nil
}

// flattenNodeWithComments recursively flattens a yaml.Node tree into
// dotted keys, preserving HeadComment from leaf key nodes.
func flattenNodeWithComments(prefix string, node *yaml.Node, result map[string]mergeEntry) {
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
			flattenNodeWithComments(key, valNode, result)
		} else {
			result[key] = mergeEntry{
				key:      key,
				value:    valNode.Value,
				comment:  keyNode.HeadComment,
				override: commentHasOverride(keyNode.HeadComment),
			}
		}
	}
}

// overrideMarker is the comment line that protects a hand-tuned translation.
const overrideMarker = "# @override"

// commentHasOverride returns true if a comment string contains @override.
func commentHasOverride(comment string) bool {
	for _, line := range strings.Split(comment, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == overrideMarker || strings.HasPrefix(trimmed, overrideMarker+" ") {
			return true
		}
	}
	return false
}

// sortedKeys returns sorted keys of a string-keyed map.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
