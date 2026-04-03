package main

import (
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestFlattenYAML(t *testing.T) {
	tests := []struct {
		name   string
		prefix string
		input  map[string]interface{}
		want   map[string]string
	}{
		{
			name:   "flat map",
			prefix: "",
			input:  map[string]interface{}{"a": "1", "b": "2"},
			want:   map[string]string{"a": "1", "b": "2"},
		},
		{
			name:   "nested map",
			prefix: "",
			input: map[string]interface{}{
				"a": map[string]interface{}{
					"b": "value",
					"c": map[string]interface{}{
						"d": "deep",
					},
				},
			},
			want: map[string]string{"a.b": "value", "a.c.d": "deep"},
		},
		{
			name:   "with prefix",
			prefix: "root",
			input:  map[string]interface{}{"key": "val"},
			want:   map[string]string{"root.key": "val"},
		},
		{
			name:   "numeric value",
			prefix: "",
			input:  map[string]interface{}{"port": 8080},
			want:   map[string]string{"port": "8080"},
		},
		{
			name:   "empty map",
			prefix: "",
			input:  map[string]interface{}{},
			want:   map[string]string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := flattenYAML(tc.prefix, tc.input)
			if len(got) != len(tc.want) {
				t.Errorf("len = %d, want %d", len(got), len(tc.want))
			}
			for k, wantV := range tc.want {
				if gotV, ok := got[k]; !ok {
					t.Errorf("missing key %q", k)
				} else if gotV != wantV {
					t.Errorf("got[%q] = %q, want %q", k, gotV, wantV)
				}
			}
		})
	}
}

func TestYamlScalar(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", "''"},
		{"hello", "hello"},
		{"hello world", "hello world"},
		{"it's here", "it's here"},
		{"yes", `"yes"`},       // YAML boolean
		{"true", `"true"`},     // YAML boolean
		{"null", `"null"`},     // YAML null
		{"123", `"123"`},       // YAML number
		{"key: value", "'key: value'"},
		{"has {var}", "has {var}"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := yamlScalar(tc.input)
			if got != tc.want {
				t.Errorf("yamlScalar(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestStripYAMLQuotes(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"plain", "plain"},
		{"'single'", "single"},
		{`"double"`, "double"},
		{"'it''s'", "it's"},
		{`"es\"caped"`, `es"caped`},
		{`"back\\slash"`, `back\slash`},
		{"''", ""},
		{`""`, ""},
		{"'", "'"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := stripYAMLQuotes(tc.input)
			if got != tc.want {
				t.Errorf("stripYAMLQuotes(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestIsValidDottedKey(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"a.b", true},
		{"foo.bar.baz", true},
		{"containerEngine.tabs.general", true},
		{"key-with-dash.sub", true},
		{"key_with_under.sub", true},
		{"A.B", true},
		{"single", false},
		{"", false},
		{".leading", false},
		{"trailing.", false},
		{"double..dot", false},
		{"has space.key", false},
		{"has/slash.key", false},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := isValidDottedKey(tc.input)
			if got != tc.want {
				t.Errorf("isValidDottedKey(%q) = %v, want %v", tc.input, got, tc.want)
			}
		})
	}
}

func TestNodeSetAndGetLeaf(t *testing.T) {
	doc := &yaml.Node{
		Kind:    yaml.DocumentNode,
		Content: []*yaml.Node{{Kind: yaml.MappingNode}},
	}
	root := documentRoot(doc)

	// Insert a new leaf.
	nodeSetLeaf(root, "a.b.c", "hello", "# @reason test")
	val, comment, found := nodeGetLeaf(root, "a.b.c")
	if !found {
		t.Fatal("a.b.c not found after insert")
	}
	if val != "hello" {
		t.Errorf("value = %q, want %q", val, "hello")
	}
	if comment != "# @reason test" {
		t.Errorf("comment = %q, want %q", comment, "# @reason test")
	}

	// Update value, preserve existing comment.
	nodeSetLeaf(root, "a.b.c", "world", "")
	val, comment, found = nodeGetLeaf(root, "a.b.c")
	if !found {
		t.Fatal("a.b.c not found after update")
	}
	if val != "world" {
		t.Errorf("value = %q, want %q", val, "world")
	}
	if comment != "# @reason test" {
		t.Errorf("comment lost after update: got %q", comment)
	}

	// Update with new comment replaces old.
	nodeSetLeaf(root, "a.b.c", "world", "# @reason new")
	_, comment, _ = nodeGetLeaf(root, "a.b.c")
	if comment != "# @reason new" {
		t.Errorf("comment = %q, want %q", comment, "# @reason new")
	}

	// Non-existent key.
	_, _, found = nodeGetLeaf(root, "x.y.z")
	if found {
		t.Error("x.y.z should not be found")
	}
}

func TestNodeInsertSorted(t *testing.T) {
	doc := &yaml.Node{
		Kind:    yaml.DocumentNode,
		Content: []*yaml.Node{{Kind: yaml.MappingNode}},
	}
	root := documentRoot(doc)

	// Insert keys out of order.
	nodeSetLeaf(root, "c.x", "3", "")
	nodeSetLeaf(root, "a.x", "1", "")
	nodeSetLeaf(root, "b.x", "2", "")

	// Top-level keys should be sorted.
	if len(root.Content) != 6 {
		t.Fatalf("expected 6 Content entries (3 key-value pairs), got %d", len(root.Content))
	}
	keys := []string{root.Content[0].Value, root.Content[2].Value, root.Content[4].Value}
	if keys[0] != "a" || keys[1] != "b" || keys[2] != "c" {
		t.Errorf("top-level keys = %v, want [a b c]", keys)
	}
}

func TestSerializeYAMLNode(t *testing.T) {
	doc := &yaml.Node{
		Kind:    yaml.DocumentNode,
		Content: []*yaml.Node{{Kind: yaml.MappingNode}},
	}
	root := documentRoot(doc)

	nodeSetLeaf(root, "action.refresh", "Refresh", "")
	nodeSetLeaf(root, "status.checking", "Checking...", "# @reason standard term")
	nodeSetLeaf(root, "status.done", "Done", "")

	var buf strings.Builder
	serializeYAMLNode(&buf, doc)
	got := buf.String()

	want := `action:
  refresh: Refresh
status:
  # @reason standard term
  checking: Checking...
  done: Done
`
	if got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestSerializeYAMLNodePreservesRoundTrip(t *testing.T) {
	// Load a YAML file, serialize it, verify comments survive.
	input := `status:
  # @reason "checking" = standard term
  versionChecking: Checking...
  updating: Updating...
`
	tmpFile := t.TempDir() + "/test.yaml"
	os.WriteFile(tmpFile, []byte(input), 0644)

	doc, err := loadYAMLDocument(tmpFile)
	if err != nil {
		t.Fatal(err)
	}

	// Add a new key.
	nodeSetLeaf(documentRoot(doc), "status.done", "Done", "")

	var buf strings.Builder
	serializeYAMLNode(&buf, doc)
	got := buf.String()

	// Original comment must survive.
	if !strings.Contains(got, `# @reason "checking" = standard term`) {
		t.Errorf("comment lost in round-trip:\n%s", got)
	}
	// New key must appear.
	if !strings.Contains(got, "done: Done") {
		t.Errorf("new key missing:\n%s", got)
	}
	// Existing values must survive.
	if !strings.Contains(got, "updating: Updating...") {
		t.Errorf("existing value lost:\n%s", got)
	}
}

func TestCommentHasOverride(t *testing.T) {
	tests := []struct {
		comment string
		want    bool
	}{
		{"# @override", true},
		{"# @override human-reviewed translation", true},
		{"# @reason standard term\n# @override", true},
		{"# @override\n# @reason something", true},
		{"# @reason no override here", false},
		{"", false},
		{"# @overridden", false}, // not an exact prefix match
	}
	for _, tc := range tests {
		got := commentHasOverride(tc.comment)
		if got != tc.want {
			t.Errorf("commentHasOverride(%q) = %v, want %v", tc.comment, got, tc.want)
		}
	}
}

func TestNodeHasOverride(t *testing.T) {
	doc := &yaml.Node{
		Kind:    yaml.DocumentNode,
		Content: []*yaml.Node{{Kind: yaml.MappingNode}},
	}
	root := documentRoot(doc)
	nodeSetLeaf(root, "a.b", "value", "# @override")
	nodeSetLeaf(root, "a.c", "value", "# @reason something")

	if !nodeHasOverride(root, "a.b") {
		t.Error("a.b should have @override")
	}
	if nodeHasOverride(root, "a.c") {
		t.Error("a.c should not have @override")
	}
	if nodeHasOverride(root, "a.d") {
		t.Error("non-existent key should not have @override")
	}
}

func TestValidateOverridePlacement(t *testing.T) {
	// Valid: @override on a leaf node.
	validYAML := `status:
  # @override
  checking: Checking...
`
	tmpFile := t.TempDir() + "/valid.yaml"
	os.WriteFile(tmpFile, []byte(validYAML), 0644)
	doc, _ := loadYAMLDocument(tmpFile)
	if errors := validateOverridePlacement(doc); len(errors) > 0 {
		t.Errorf("expected no errors for valid placement, got %v", errors)
	}

	// Invalid: @override on a parent mapping node.
	invalidYAML := `# @override
status:
  checking: Checking...
`
	tmpFile2 := t.TempDir() + "/invalid.yaml"
	os.WriteFile(tmpFile2, []byte(invalidYAML), 0644)
	doc2, _ := loadYAMLDocument(tmpFile2)
	errors := validateOverridePlacement(doc2)
	if len(errors) != 1 || errors[0] != "status" {
		t.Errorf("expected [status], got %v", errors)
	}
}

func TestLoadYAMLWithCommentsOverride(t *testing.T) {
	input := `status:
  # @override
  checking: Checking...
  # @reason standard term
  updating: Updating...
`
	tmpFile := t.TempDir() + "/test.yaml"
	os.WriteFile(tmpFile, []byte(input), 0644)
	got, err := loadYAMLWithComments(tmpFile)
	if err != nil {
		t.Fatal(err)
	}

	if !got["status.checking"].override {
		t.Error("status.checking should have override=true")
	}
	if got["status.updating"].override {
		t.Error("status.updating should not have override=true")
	}
}

func TestLoadYAMLWithComments(t *testing.T) {
	// Write a temp YAML file with comments and load it.
	input := `status:
  # @reason "checking" = standard term
  versionChecking: Checking...
  # @reason multi-line reason;
  #   continued here
  updating: Updating...
  noComment: plain value
locale:
  name: English
`
	tmpFile := t.TempDir() + "/test.yaml"
	if err := os.WriteFile(tmpFile, []byte(input), 0644); err != nil {
		t.Fatal(err)
	}
	got, err := loadYAMLWithComments(tmpFile)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		key     string
		value   string
		comment string
	}{
		{"status.versionChecking", "Checking...", "# @reason \"checking\" = standard term"},
		{"status.updating", "Updating...", "# @reason multi-line reason;\n#   continued here"},
		{"status.noComment", "plain value", ""},
		{"locale.name", "English", ""},
	}
	for _, tc := range tests {
		e, ok := got[tc.key]
		if !ok {
			t.Errorf("missing key %q", tc.key)
			continue
		}
		if e.value != tc.value {
			t.Errorf("key %q: value = %q, want %q", tc.key, e.value, tc.value)
		}
		if e.comment != tc.comment {
			t.Errorf("key %q: comment = %q, want %q", tc.key, e.comment, tc.comment)
		}
	}
}

