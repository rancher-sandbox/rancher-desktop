// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

// setupUntranslatedRepo writes the given files under pkg/rancher-desktop and
// returns the repo root, so findUntranslated has a source tree to scan.
func setupUntranslatedRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "pkg", "rancher-desktop")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range files {
		path := filepath.Join(srcDir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestReportUntranslatedEmptyJSON(t *testing.T) {
	// A file whose only string sits inside a t() call yields no hits.
	dir := setupUntranslatedRepo(t, map[string]string{
		"clean.ts": "const label = t('foo.bar');\n",
	})
	var buf bytes.Buffer
	if err := reportUntranslated(&buf, dir, "json", false); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(buf.String()); got != "[]" {
		t.Errorf("empty result encoded as %q, want []", got)
	}
}

func TestFindUntranslatedDetectsObjectLabel(t *testing.T) {
	dir := setupUntranslatedRepo(t, map[string]string{
		"columns.ts": "const columns = [\n  {\n    label: 'Local Port',\n  },\n];\n",
	})
	hits, err := findUntranslated(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 {
		t.Fatalf("got %d hits, want 1: %+v", len(hits), hits)
	}
	if !strings.Contains(hits[0].Context, "Local Port") {
		t.Errorf("hit context = %q, want it to mention 'Local Port'", hits[0].Context)
	}
}

func TestFindUntranslatedUnreadableFileIsAnError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file modes cannot make a file unreadable on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("root can read mode-0 files")
	}
	dir := setupUntranslatedRepo(t, nil)
	broken := filepath.Join(dir, "pkg", "rancher-desktop", "Broken.vue")
	if err := os.WriteFile(broken, []byte(`label="Reset Kubernetes"`+"\n"), 0); err != nil {
		t.Fatal(err)
	}

	if _, err := findUntranslated(dir, false); err == nil {
		t.Error("expected an error for an unreadable source file")
	}
}

func TestValuePatterns(t *testing.T) {
	tests := []struct {
		name    string
		pattern *regexp.Regexp
		group   int
		line    string
		wantVal string // empty means no match
	}{
		{"attr: label with space", attrPattern, 2, `label="Reset Kubernetes"`, "Reset Kubernetes"},
		{"attr: placeholder", attrPattern, 2, `placeholder="Enter a value"`, "Enter a value"},
		{"attr: tooltip", attrPattern, 2, `tooltip="This is helpful"`, "This is helpful"},
		{"attr: short value skipped", attrPattern, 2, `label="ab"`, ""},
		{"attr: bound attr not matched", attrPattern, 2, `:label="t('key')"`, ""},
		{"attr: description attr", attrPattern, 2, `description="Some long text"`, "Some long text"},
		{"htmlText: text between tags", htmlTextPattern, 1, `<h1>Reset Kubernetes</h1>`, "Reset Kubernetes"},
		{"htmlText: single word", htmlTextPattern, 1, `<span>Environment</span>`, "Environment"},
		{"htmlText: lowercase skipped", htmlTextPattern, 1, `<p>not a match</p>`, ""},
		{"htmlText: short text", htmlTextPattern, 1, `<b>A</b>`, ""},
		{"boundLiteral: bound label", boundLiteralPattern, 2, `:label="'Include Kubernetes services'"`, "Include Kubernetes services"},
		{"boundLiteral: bound placeholder", boundLiteralPattern, 2, `:placeholder="'Search...'"`, "Search..."},
		{"boundLiteral: too short", boundLiteralPattern, 2, `:label="'ab'"`, ""},
		{"boundLiteral: no match", boundLiteralPattern, 2, `label="plain"`, ""},
		{"objectLabel: table header label", objectLabelPattern, 2, `label: 'Local Port',`, "Local Port"},
		{"objectLabel: double quoted", objectLabelPattern, 2, `label: "Namespace",`, "Namespace"},
		{"objectLabel: tooltip literal", objectLabelPattern, 2, `tooltip: 'Restart the container',`, "Restart the container"},
		{"objectLabel: t() call not matched", objectLabelPattern, 2, `label: this.t('containers.title'),`, ""},
		{"objectLabel: lowercase value not matched", objectLabelPattern, 2, `label: 'name',`, ""},
		{"objectLabel: non-label property not matched", objectLabelPattern, 2, `name: 'Namespace',`, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := tc.pattern.FindStringSubmatch(tc.line)
			var got string
			if m != nil {
				got = m[tc.group]
			}
			if tc.wantVal == "" && got != "" {
				t.Errorf("expected no match, got %q", got)
			} else if tc.wantVal != "" && got != tc.wantVal {
				t.Errorf("got %q, want %q", got, tc.wantVal)
			}
		})
	}
}

func TestSkipPattern(t *testing.T) {
	tests := []struct {
		name string
		val  string
		want bool // true = should skip
	}{
		{"camelCase identifier", "containerName", true},
		{"starts with number", "123abc", true},
		{"starts with http", "http://example.com", true},
		{"starts with slash", "/path/to", true},
		{"starts with hash", "#anchor", true},
		{"starts with dollar", "$variable", true},
		{"starts with at", "@slot", true},
		{"starts with colon", ":bound", true},
		{"starts with brace", "{expr}", true},
		{"multi-word text", "Hello World", false},
		{"Title Case", "Environment", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := skipPattern.MatchString(tc.val)
			if got != tc.want {
				t.Errorf("skipPattern.MatchString(%q) = %v, want %v", tc.val, got, tc.want)
			}
		})
	}
}

func TestSingleWordTitleCase(t *testing.T) {
	tests := []struct {
		val  string
		want bool
	}{
		{"Environment", true},
		{"General", true},
		{"Ab", false},        // too short (< 3 lowercase)
		{"ABC", false},       // not Title Case
		{"hello", false},     // lowercase start
		{"Two Words", false}, // has space
	}

	for _, tc := range tests {
		t.Run(tc.val, func(t *testing.T) {
			got := singleWordTitleCase.MatchString(tc.val)
			if got != tc.want {
				t.Errorf("singleWordTitleCase(%q) = %v, want %v", tc.val, got, tc.want)
			}
		})
	}
}

func TestBareTextPattern(t *testing.T) {
	tests := []struct {
		val  string
		want bool
	}{
		{"Cancel", true},
		{"Reset Kubernetes", true},
		{"Two Words Here", true},
		{"lowercase", false},
		{"A", false},            // too short
		{"Ab", false},           // too short
		{"has123number", false}, // contains digit
	}

	for _, tc := range tests {
		t.Run(tc.val, func(t *testing.T) {
			got := bareTextPattern.MatchString(tc.val)
			if got != tc.want {
				t.Errorf("bareTextPattern(%q) = %v, want %v", tc.val, got, tc.want)
			}
		})
	}
}

func TestErrorPushPattern(t *testing.T) {
	tests := []struct {
		name string
		line string
		want bool
	}{
		{"single quote", `errors.push('some error')`, true},
		{"double quote", `errors.push("some error")`, true},
		{"backtick", "errors.push(`template error`)", true},
		{"no match", `errors.push(variable)`, false},
		{"no match 2", `console.log('test')`, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := errorPushPattern.MatchString(tc.line)
			if got != tc.want {
				t.Errorf("errorPushPattern(%q) = %v, want %v", tc.line, got, tc.want)
			}
		})
	}
}

func TestTCallPattern(t *testing.T) {
	tests := []struct {
		line string
		want bool
	}{
		{`this.t('a.b')`, true},
		{`t('a.b')`, true},
		{`:label="t('a.b')"`, true},
		{`restart('Now')`, false},
		{`format('Text')`, false},
	}

	for _, tc := range tests {
		if got := tCallPattern.MatchString(tc.line); got != tc.want {
			t.Errorf("tCallPattern(%q) = %v, want %v", tc.line, got, tc.want)
		}
	}
}
