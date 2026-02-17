package main

import (
	"os"
	"strings"
	"testing"
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

func TestWriteNestedYAML(t *testing.T) {
	tests := []struct {
		name    string
		entries []mergeEntry
		want    string
	}{
		{
			name: "single key",
			entries: []mergeEntry{
				{key: "a.b", value: "hello"},
			},
			want: "a:\n  b: hello\n",
		},
		{
			name: "two keys same parent",
			entries: []mergeEntry{
				{key: "a.x", value: "1"},
				{key: "a.y", value: "2"},
			},
			want: "a:\n  x: \"1\"\n  y: \"2\"\n",
		},
		{
			name: "blank line between top-level groups",
			entries: []mergeEntry{
				{key: "a.x", value: "1"},
				{key: "b.y", value: "2"},
			},
			want: "a:\n  x: \"1\"\n\nb:\n  y: \"2\"\n",
		},
		{
			name: "with comment",
			entries: []mergeEntry{
				{key: "a.b", value: "val", comment: "# @reason test"},
			},
			want: "a:\n  # @reason test\n  b: val\n",
		},
		{
			name: "deep nesting",
			entries: []mergeEntry{
				{key: "a.b.c.d", value: "deep"},
			},
			want: "a:\n  b:\n    c:\n      d: deep\n",
		},
		{
			name: "sorted output",
			entries: []mergeEntry{
				{key: "z.a", value: "last"},
				{key: "a.z", value: "first"},
			},
			want: "a:\n  z: first\n\nz:\n  a: last\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf strings.Builder
			writeNestedYAML(&buf, tc.entries)
			got := buf.String()
			if got != tc.want {
				t.Errorf("got:\n%s\nwant:\n%s", got, tc.want)
			}
		})
	}
}
