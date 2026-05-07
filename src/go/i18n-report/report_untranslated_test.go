package main

import (
	"testing"
)

func TestAttrPattern(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		wantVal string // empty means no match
	}{
		{"label with space", `label="Reset Kubernetes"`, "Reset Kubernetes"},
		{"placeholder", `placeholder="Enter a value"`, "Enter a value"},
		{"tooltip", `tooltip="This is helpful"`, "This is helpful"},
		{"short value skipped", `label="ab"`, ""},
		{"bound attr not matched", `:label="t('key')"`, ""},
		{"description attr", `description="Some long text"`, "Some long text"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := attrPattern.FindStringSubmatch(tc.line)
			var got string
			if m != nil {
				got = m[2]
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
		{"Ab", false},      // too short (< 3 lowercase)
		{"ABC", false},      // not Title Case
		{"hello", false},    // lowercase start
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

func TestHTMLTextPattern(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		wantVal string
	}{
		{"text between tags", `<h1>Reset Kubernetes</h1>`, "Reset Kubernetes"},
		{"single word", `<span>Environment</span>`, "Environment"},
		{"lowercase skipped", `<p>not a match</p>`, ""},
		{"short text", `<b>A</b>`, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := htmlTextPattern.FindStringSubmatch(tc.line)
			var got string
			if m != nil {
				got = m[1]
			}
			if tc.wantVal == "" && got != "" {
				t.Errorf("expected no match, got %q", got)
			} else if tc.wantVal != "" && got != tc.wantVal {
				t.Errorf("got %q, want %q", got, tc.wantVal)
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
		{"A", false},          // too short
		{"Ab", false},         // too short
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

func TestBoundLiteralPattern(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		wantVal string
	}{
		{"bound label", `:label="'Include Kubernetes services'"`, "Include Kubernetes services"},
		{"bound placeholder", `:placeholder="'Search...'"`, "Search..."},
		{"too short", `:label="'ab'"`, ""},
		{"no match", `label="plain"`, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := boundLiteralPattern.FindStringSubmatch(tc.line)
			var got string
			if m != nil {
				got = m[2]
			}
			if tc.wantVal == "" && got != "" {
				t.Errorf("expected no match, got %q", got)
			} else if tc.wantVal != "" && got != tc.wantVal {
				t.Errorf("got %q, want %q", got, tc.wantVal)
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
