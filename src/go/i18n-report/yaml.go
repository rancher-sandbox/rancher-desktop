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

// commentHasOverride returns true if a comment string contains @override.
func commentHasOverride(comment string) bool {
	for _, line := range strings.Split(comment, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "# @override" || strings.HasPrefix(trimmed, "# @override ") {
			return true
		}
	}
	return false
}

// nodeHasOverride returns true if a leaf key's HeadComment contains @override.
func nodeHasOverride(root *yaml.Node, dottedKey string) bool {
	_, comment, found := nodeGetLeaf(root, dottedKey)
	if !found {
		return false
	}
	return commentHasOverride(comment)
}

// validateOverridePlacement checks that @override only appears on leaf key
// nodes, not on parent mapping nodes. Returns a list of invalid placements.
func validateOverridePlacement(doc *yaml.Node) []string {
	root := documentRoot(doc)
	var errors []string
	checkOverridePlacement("", root, &errors)
	return errors
}

// checkOverridePlacement recursively checks for misplaced @override on
// parent mapping nodes.
func checkOverridePlacement(prefix string, node *yaml.Node, errors *[]string) {
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
			// Parent mapping — @override is invalid here.
			if commentHasOverride(keyNode.HeadComment) {
				*errors = append(*errors, key)
			}
			checkOverridePlacement(key, valNode, errors)
		}
		// Leaf nodes with @override are valid — no error.
	}
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
	return strings.TrimSuffix(string(data), "\n")
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

// loadYAMLDocument loads a YAML file into a yaml.Node document tree.
// Returns a DocumentNode wrapping a MappingNode root.
// If the file does not exist, returns an empty document.
func loadYAMLDocument(path string) (*yaml.Node, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		// Return an empty document with an empty mapping root.
		return &yaml.Node{
			Kind: yaml.DocumentNode,
			Content: []*yaml.Node{
				{Kind: yaml.MappingNode},
			},
		}, nil
	}
	if err != nil {
		return nil, err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return &yaml.Node{
			Kind: yaml.DocumentNode,
			Content: []*yaml.Node{
				{Kind: yaml.MappingNode},
			},
		}, nil
	}
	return &doc, nil
}

// documentRoot returns the root MappingNode from a DocumentNode.
func documentRoot(doc *yaml.Node) *yaml.Node {
	if doc.Kind == yaml.DocumentNode && len(doc.Content) > 0 {
		return doc.Content[0]
	}
	return doc
}

// nodeSetLeaf sets a leaf value in a yaml.Node tree by dotted key path.
// It creates intermediate MappingNode entries as needed.
// If comment is non-empty, it replaces the key node's HeadComment.
// If comment is empty and the key already exists, the existing comment is preserved.
func nodeSetLeaf(root *yaml.Node, dottedKey, value, comment string) error {
	parts := strings.Split(dottedKey, ".")
	current := root

	// Navigate or create intermediate mapping nodes.
	for i, part := range parts {
		isLeaf := i == len(parts)-1
		keyIdx := nodeFindKey(current, part)

		if keyIdx >= 0 {
			// Key exists.
			valNode := current.Content[keyIdx+1]
			if isLeaf {
				// Update leaf value.
				valNode.Kind = yaml.ScalarNode
				valNode.Tag = ""
				valNode.Value = value
				valNode.Style = scalarStyle(value)
				// Preserve existing comment if no new comment provided.
				if comment != "" {
					current.Content[keyIdx].HeadComment = comment
				}
			} else {
				// Descend into existing mapping.
				if valNode.Kind != yaml.MappingNode {
					return fmt.Errorf("key %q is a leaf; cannot create child %q",
						strings.Join(parts[:i+1], "."), dottedKey)
				}
				current = valNode
			}
		} else {
			// Key does not exist — insert in sorted position.
			if isLeaf {
				keyNode := &yaml.Node{
					Kind:  yaml.ScalarNode,
					Value: part,
				}
				if comment != "" {
					keyNode.HeadComment = comment
				}
				valNode := &yaml.Node{
					Kind:  yaml.ScalarNode,
					Value: value,
					Style: scalarStyle(value),
				}
				nodeInsertSorted(current, keyNode, valNode)
			} else {
				keyNode := &yaml.Node{
					Kind:  yaml.ScalarNode,
					Value: part,
				}
				valNode := &yaml.Node{
					Kind: yaml.MappingNode,
				}
				nodeInsertSorted(current, keyNode, valNode)
				current = valNode
			}
		}
	}
	return nil
}

// nodeGetLeaf retrieves a leaf's value and HeadComment from the tree.
// Returns empty strings and false if the key is not found.
func nodeGetLeaf(root *yaml.Node, dottedKey string) (value, comment string, found bool) {
	parts := strings.Split(dottedKey, ".")
	current := root
	for i, part := range parts {
		idx := nodeFindKey(current, part)
		if idx < 0 {
			return "", "", false
		}
		if i == len(parts)-1 {
			return current.Content[idx+1].Value, current.Content[idx].HeadComment, true
		}
		valNode := current.Content[idx+1]
		if valNode.Kind != yaml.MappingNode {
			return "", "", false
		}
		current = valNode
	}
	return "", "", false
}


// nodeFindKey finds a key in a MappingNode's Content, returning its index
// or -1 if not found.
func nodeFindKey(mapping *yaml.Node, key string) int {
	if mapping.Kind != yaml.MappingNode {
		return -1
	}
	for i := 0; i < len(mapping.Content)-1; i += 2 {
		if mapping.Content[i].Value == key {
			return i
		}
	}
	return -1
}

// nodeInsertSorted inserts a key-value pair into a MappingNode
// in alphabetically sorted position.
func nodeInsertSorted(mapping *yaml.Node, keyNode, valNode *yaml.Node) {
	insertAt := len(mapping.Content)
	for i := 0; i < len(mapping.Content)-1; i += 2 {
		if mapping.Content[i].Value > keyNode.Value {
			insertAt = i
			break
		}
	}
	// Insert at position.
	newContent := make([]*yaml.Node, 0, len(mapping.Content)+2)
	newContent = append(newContent, mapping.Content[:insertAt]...)
	newContent = append(newContent, keyNode, valNode)
	newContent = append(newContent, mapping.Content[insertAt:]...)
	mapping.Content = newContent
}

// scalarStyle returns the yaml.Style to use for a scalar value.
// Style is set for node-tree correctness but not consumed by
// serializeYAMLNode, which formats scalars via yamlScalar() directly.
func scalarStyle(value string) yaml.Style {
	if strings.Contains(value, "\n") {
		return yaml.LiteralStyle
	}
	// Check if yaml.Marshal would quote this value.
	data, err := yaml.Marshal(value)
	if err != nil {
		return yaml.DoubleQuotedStyle
	}
	rendered := strings.TrimSuffix(string(data), "\n")
	// If the rendered form uses quotes, use the same style.
	if len(rendered) > 0 && (rendered[0] == '\'' || rendered[0] == '"') {
		return yaml.DoubleQuotedStyle
	}
	return 0 // default (no forced style)
}

// nodeAllLeaves returns all leaf entries from a yaml.Node tree as a flat map.
func nodeAllLeaves(root *yaml.Node) map[string]mergeEntry {
	result := make(map[string]mergeEntry)
	flattenNodeWithComments("", root, result)
	return result
}

// serializeYAMLNode writes a yaml.Node tree as YAML text.
// It does not insert blank lines between top-level groups, which keeps
// round-trips stable regardless of the original file's formatting.
func serializeYAMLNode(w *strings.Builder, doc *yaml.Node) {
	root := documentRoot(doc)
	if root.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i < len(root.Content)-1; i += 2 {
		serializeNode(w, root.Content[i], root.Content[i+1], 0)
	}
}

// serializeNode writes a key-value pair at the given indentation depth.
func serializeNode(w *strings.Builder, keyNode, valNode *yaml.Node, depth int) {
	indent := strings.Repeat("  ", depth)

	// Write HeadComment from the key node.
	if keyNode.HeadComment != "" {
		for _, line := range strings.Split(keyNode.HeadComment, "\n") {
			w.WriteString(indent)
			w.WriteString(line)
			w.WriteString("\n")
		}
	}

	w.WriteString(indent)
	w.WriteString(keyNode.Value)

	if valNode.Kind == yaml.MappingNode {
		w.WriteString(":\n")
		for i := 0; i < len(valNode.Content)-1; i += 2 {
			serializeNode(w, valNode.Content[i], valNode.Content[i+1], depth+1)
		}
	} else {
		w.WriteString(": ")
		scalar := yamlScalar(valNode.Value)
		if strings.Contains(scalar, "\n") {
			lines := strings.Split(scalar, "\n")
			w.WriteString(lines[0])
			w.WriteString("\n")
			bodyIndent := indent + "  "
			for _, line := range lines[1:] {
				trimmed := strings.TrimPrefix(line, "  ")
				if trimmed == "" {
					w.WriteString("\n")
				} else {
					w.WriteString(bodyIndent)
					w.WriteString(trimmed)
					w.WriteString("\n")
				}
			}
		} else {
			w.WriteString(scalar)
			w.WriteString("\n")
		}
	}
}

