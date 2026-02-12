package main

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// flattenYAML flattens a nested YAML map into dotted keys.
func flattenYAML(prefix string, node map[string]interface{}) map[string]string {
	result := make(map[string]string)
	for k, v := range node {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		switch val := v.(type) {
		case map[string]interface{}:
			for fk, fv := range flattenYAML(key, val) {
				result[fk] = fv
			}
		default:
			if val == nil {
				result[key] = ""
			} else {
				result[key] = fmt.Sprintf("%v", val)
			}
		}
	}
	return result
}

// loadYAMLFlat loads a YAML file and returns flattened key-value pairs.
func loadYAMLFlat(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return flattenYAML("", raw), nil
}

// sortedKeys returns sorted keys of a string map.
func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// isValidDottedKey returns true if s looks like a dotted translation key
// (e.g., "action.refresh", "containerEngine.tabs.general").
func isValidDottedKey(s string) bool {
	parts := strings.Split(s, ".")
	if len(parts) < 2 {
		return false
	}
	for _, part := range parts {
		if part == "" {
			return false
		}
		for _, c := range part {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
				return false
			}
		}
	}
	return true
}

// yamlScalar formats a string as a YAML scalar value, adding quotes
// when needed for special characters.
func yamlScalar(s string) string {
	if s == "" {
		return "''"
	}
	data, err := yaml.Marshal(s)
	if err != nil {
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	return strings.TrimRight(string(data), "\n")
}

// stripYAMLQuotes removes outer YAML quotes from a value string.
func stripYAMLQuotes(s string) string {
	if len(s) >= 2 && s[0] == '\'' && s[len(s)-1] == '\'' {
		inner := s[1 : len(s)-1]
		return strings.ReplaceAll(inner, "''", "'")
	}
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		inner := s[1 : len(s)-1]
		inner = strings.ReplaceAll(inner, `\"`, `"`)
		inner = strings.ReplaceAll(inner, `\\`, `\`)
		return inner
	}
	return s
}

// writeNestedYAML writes a sorted slice of mergeEntry items as nested YAML
// with @reason comments to the given writer. The structure matches en-us.yaml.
func writeNestedYAML(w *strings.Builder, entries []mergeEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].key < entries[j].key
	})

	// Build a map for quick lookup.
	entryMap := make(map[string]mergeEntry, len(entries))
	keys := make([]string, 0, len(entries))
	for _, e := range entries {
		entryMap[e.key] = e
		keys = append(keys, e.key)
	}

	var prevParts []string
	for _, key := range keys {
		e := entryMap[key]
		parts := strings.Split(key, ".")

		// Find common prefix length with previous key (comparing parent segments).
		common := 0
		maxParent := len(parts) - 1
		if len(prevParts)-1 < maxParent {
			maxParent = len(prevParts) - 1
		}
		for j := 0; j < maxParent; j++ {
			if parts[j] == prevParts[j] {
				common = j + 1
			} else {
				break
			}
		}

		// Add blank line between different top-level groups.
		if len(prevParts) > 0 && parts[0] != prevParts[0] {
			w.WriteString("\n")
		}

		// Emit new parent nodes.
		for j := common; j < len(parts)-1; j++ {
			indent := strings.Repeat("  ", j)
			w.WriteString(indent)
			w.WriteString(parts[j])
			w.WriteString(":\n")
		}

		// Emit @reason comment and leaf value.
		depth := len(parts) - 1
		indent := strings.Repeat("  ", depth)

		if e.comment != "" {
			for _, commentLine := range strings.Split(e.comment, "\n") {
				w.WriteString(indent)
				w.WriteString(commentLine)
				w.WriteString("\n")
			}
		}

		leaf := parts[len(parts)-1]
		w.WriteString(indent)
		w.WriteString(leaf)
		w.WriteString(": ")
		w.WriteString(yamlScalar(e.value))
		w.WriteString("\n")

		prevParts = parts
	}
}
