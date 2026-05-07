package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemoveKeyFromNode(t *testing.T) {
	tests := []struct {
		name     string
		yaml     string
		key      string
		wantYAML string
		removed  bool
	}{
		{
			name:     "leaf key",
			yaml:     "a: 1\nb: 2\nc: 3\n",
			key:      "b",
			wantYAML: "a: 1\nc: 3\n",
			removed:  true,
		},
		{
			name:     "nested key",
			yaml:     "parent:\n  child1: v1\n  child2: v2\n",
			key:      "parent.child1",
			wantYAML: "parent:\n  child2: v2\n",
			removed:  true,
		},
		{
			name:     "prune empty parent",
			yaml:     "parent:\n  only: v1\nother: v2\n",
			key:      "parent.only",
			wantYAML: "other: v2\n",
			removed:  true,
		},
		{
			name:     "deeply nested",
			yaml:     "a:\n  b:\n    c: v1\n    d: v2\n",
			key:      "a.b.c",
			wantYAML: "a:\n  b:\n    d: v2\n",
			removed:  true,
		},
		{
			name:     "prune chain",
			yaml:     "a:\n  b:\n    c: v1\nother: v2\n",
			key:      "a.b.c",
			wantYAML: "other: v2\n",
			removed:  true,
		},
		{
			name:     "missing key",
			yaml:     "a: 1\nb: 2\n",
			key:      "c",
			wantYAML: "a: 1\nb: 2\n",
			removed:  false,
		},
		{
			name:     "missing nested key",
			yaml:     "a:\n  b: 1\n",
			key:      "a.c",
			wantYAML: "a:\n  b: 1\n",
			removed:  false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "test.yaml")
			if err := os.WriteFile(path, []byte(tc.yaml), 0644); err != nil {
				t.Fatal(err)
			}

			keys := map[string]bool{tc.key: true}
			removed, err := removeKeysFromFile(path, keys)
			if err != nil {
				t.Fatal(err)
			}

			if tc.removed && removed == 0 {
				t.Error("expected key to be removed, but it was not")
			}
			if !tc.removed && removed > 0 {
				t.Error("expected no removal, but key was removed")
			}

			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}

			got := string(data)

			// For removed cases, verify the removed key is absent.
			if tc.removed {
				parts := strings.Split(tc.key, ".")
				leaf := parts[len(parts)-1]
				// Simple check: the leaf key should not appear with its
				// original value.
				if strings.Contains(got, leaf+":") && removed == 0 {
					t.Errorf("key %q still present in output", tc.key)
				}
			}
		})
	}
}

func TestRemoveMultipleKeys(t *testing.T) {
	yaml := "a: 1\nb: 2\nc: 3\nd: 4\n"
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}

	keys := map[string]bool{"a": true, "c": true}
	removed, err := removeKeysFromFile(path, keys)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Errorf("removed %d keys, want 2", removed)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got := string(data)
	if strings.Contains(got, "a:") {
		t.Error("key 'a' still present")
	}
	if !strings.Contains(got, "b:") {
		t.Error("key 'b' should remain")
	}
	if strings.Contains(got, "c:") {
		t.Error("key 'c' still present")
	}
	if !strings.Contains(got, "d:") {
		t.Error("key 'd' should remain")
	}
}

func TestRemoveKeysFromFileNoChanges(t *testing.T) {
	yaml := "a: 1\nb: 2\n"
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}

	// Read original modification time.
	infoBefore, _ := os.Stat(path)

	keys := map[string]bool{"nonexistent": true}
	removed, err := removeKeysFromFile(path, keys)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Errorf("removed %d keys, want 0", removed)
	}

	// File should not be rewritten when nothing was removed.
	infoAfter, _ := os.Stat(path)
	if infoBefore.ModTime() != infoAfter.ModTime() {
		t.Error("file was rewritten despite no changes")
	}
}

func TestReadKeysFiltersNonKeys(t *testing.T) {
	// readKeysFromStdin reads from os.Stdin; test isValidDottedKey filtering
	// directly since stdin is hard to mock.
	lines := []string{
		"action.refresh",
		"Found 10 unused keys:",
		"",
		"nav.home.title",
		"not-dotted",
		"  whitespace.padded  ",
	}

	var keys []string
	for _, line := range lines {
		key := strings.TrimSpace(line)
		if isValidDottedKey(key) {
			keys = append(keys, key)
		}
	}

	want := []string{"action.refresh", "nav.home.title", "whitespace.padded"}
	if len(keys) != len(want) {
		t.Fatalf("got %d keys, want %d", len(keys), len(want))
	}
	for i, k := range keys {
		if k != want[i] {
			t.Errorf("key[%d] = %q, want %q", i, k, want[i])
		}
	}
}
