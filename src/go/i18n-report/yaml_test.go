// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestNodeRoundTripPreservesDottedSegmentKey(t *testing.T) {
	// en-us.yaml nests secret-type labels under keys whose own segment
	// contains a literal dot, e.g. "kubernetes.io/service-account-token".
	// Flattening then rewriting such a key must keep it a single mapping
	// key, not split it into nested "kubernetes" / "io/..." nodes.
	src := "secret:\n" +
		"  types:\n" +
		"    'kubernetes.io/service-account-token': Svc Acct Token\n"
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(src), &doc); err != nil {
		t.Fatal(err)
	}
	entries := map[string]mergeEntry{}
	flattenNodeWithComments("", documentRoot(&doc), entries)

	var out yaml.Node
	out.Kind = yaml.DocumentNode
	out.Content = []*yaml.Node{{Kind: yaml.MappingNode}}
	for k, e := range entries {
		if err := nodeSetLeaf(out.Content[0], k, e.value, e.comment); err != nil {
			t.Fatal(err)
		}
	}
	var sb strings.Builder
	serializeYAMLNode(&sb, &out)
	want := "secret:\n" +
		"  types:\n" +
		"    kubernetes.io/service-account-token: Svc Acct Token\n"
	if sb.String() != want {
		t.Errorf("round-trip corrupted key structure:\ngot:\n%s\nwant:\n%s", sb.String(), want)
	}
}

func TestSerializeNodeQuotesOnlyUnsafeKeys(t *testing.T) {
	emit := func(key string) string {
		out := yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{
			Kind: yaml.MappingNode,
			Content: []*yaml.Node{
				{Kind: yaml.ScalarNode, Value: key},
				{Kind: yaml.ScalarNode, Value: "v"},
			},
		}}}
		var sb strings.Builder
		serializeYAMLNode(&sb, &out)
		return sb.String()
	}

	// Keys that are not plain-safe scalars must be quoted, or they fail to
	// round-trip. "#comment" is the worst case: emitted raw it becomes a YAML
	// comment and the key vanishes with no error.
	for _, key := range []string{"#comment", "[bracket]", "colon: space", "*star", "@at"} {
		emitted := emit(key)
		var m map[string]string
		if err := yaml.Unmarshal([]byte(emitted), &m); err != nil {
			t.Errorf("key %q: emitted YAML fails to parse: %v\n%s", key, err, emitted)
			continue
		}
		if _, ok := m[key]; !ok {
			t.Errorf("key %q lost on round-trip; emitted:\n%s", key, emitted)
		}
	}

	// Benign non-plain scalars round-trip as keys already, so quoting them
	// would churn checked-in locale files for no gain.
	for _, key := range []string{"yes", "true", "no"} {
		emitted := emit(key)
		if strings.ContainsAny(emitted, `"'`) {
			t.Errorf("benign key %q was needlessly quoted:\n%s", key, emitted)
		}
	}
}

func TestSerializeYAMLNodeIdempotentWithBanner(t *testing.T) {
	// A decorative banner comment set off by blank lines must survive a
	// serialize -> parse -> serialize round-trip. yaml.v3 keeps a trailing
	// newline on the HeadComment; emitting it as a blank line detached the
	// banner on re-parse, so the second serialize dropped it.
	src := "root:\n  a: one\n\n  ### Section\n\n  b: two\n"
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(src), &doc); err != nil {
		t.Fatal(err)
	}
	var buf1 strings.Builder
	serializeYAMLNode(&buf1, &doc)
	if !strings.Contains(buf1.String(), "### Section") {
		t.Fatalf("banner dropped on first serialize:\n%s", buf1.String())
	}

	var doc2 yaml.Node
	if err := yaml.Unmarshal([]byte(buf1.String()), &doc2); err != nil {
		t.Fatal(err)
	}
	var buf2 strings.Builder
	serializeYAMLNode(&buf2, &doc2)
	if buf1.String() != buf2.String() {
		t.Errorf("serialize not idempotent:\n--- first ---\n%s\n--- second ---\n%s", buf1.String(), buf2.String())
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
		{"yes", `"yes"`},   // YAML boolean
		{"true", `"true"`}, // YAML boolean
		{"null", `"null"`}, // YAML null
		{"123", `"123"`},   // YAML number
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

// An empty path segment names no key. Accepting one would emit ": value",
// which is not valid YAML, silently corrupting the locale file.
func TestNodeSetLeafRejectsEmptySegment(t *testing.T) {
	for _, key := range []string{"", "a.", ".a", "a..b"} {
		doc := &yaml.Node{
			Kind:    yaml.DocumentNode,
			Content: []*yaml.Node{{Kind: yaml.MappingNode}},
		}
		if err := nodeSetLeaf(documentRoot(doc), key, "value", ""); err == nil {
			var buf strings.Builder
			serializeYAMLNode(&buf, doc)
			t.Errorf("nodeSetLeaf(%q) = nil, want error; emitted %q", key, buf.String())
		}
	}
}

// A malformed key resolves to a different, real key that merge would write to
// and remove would delete.
func TestIsValidDottedKeyRejectsMalformedQuotes(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"action.refresh", true},
		{"containerEngine.tabs.general", true},
		{`secret.types."kubernetes.io/service-account-token"`, true},
		{`secret.types.'helm.sh/release.v1'`, true},
		{`a"b.c`, false},                                             // resolved to a.b.c
		{`a.b"c"d.e`, false},                                         // resolved to a.b.c.d.e
		{`secret.types."kubernetes.io/service-account-token`, false}, // split into kubernetes / io/... nodes
		{`"a.b"c`, false},
		{"a", false},
	}

	for _, tc := range tests {
		t.Run(tc.key, func(t *testing.T) {
			if got := isValidDottedKey(tc.key); got != tc.want {
				t.Errorf("isValidDottedKey(%q) = %v, want %v", tc.key, got, tc.want)
			}
		})
	}
}

// merge accepts `key: "value"`, so a quoted value must mean what YAML says it
// means. Hand-unescaping only \" and \\ turns "Line\nTwo" into a literal backslash.
func TestStripYAMLQuotesResolvesEscapes(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{`"Line\nTwo"`, "Line\nTwo"},
		{`"Tab\there"`, "Tab\there"},
		{`"café"`, "café"},
		{`"say \"hi\""`, `say "hi"`},
		{`'it''s'`, "it's"},
		{"plain value", "plain value"},
		{`"unterminated`, `"unterminated`},
		{`'tis the season`, `'tis the season`},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			if got := stripYAMLQuotes(tc.input); got != tc.want {
				t.Errorf("stripYAMLQuotes(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
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

func TestStripOverrideMarker(t *testing.T) {
	tests := []struct {
		comment string
		want    string
	}{
		{"# @override", ""},
		{"# @override human-reviewed", ""},
		{"# @reason standard term\n# @override", "# @reason standard term"},
		{"# @reason no override here", "# @reason no override here"},
		// A note that only contains @override as a substring is not a marker; strip only exact marker lines.
		{"# do not @override casually", "# do not @override casually"},
		{"# @override\n# @override-note keep me", "# @override-note keep me"},
	}
	for _, tc := range tests {
		got := stripOverrideMarker(tc.comment)
		if got != tc.want {
			t.Errorf("stripOverrideMarker(%q) = %q, want %q", tc.comment, got, tc.want)
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
