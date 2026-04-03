package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseMergeInput(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    []mergeEntry
		wantErr bool
	}{
		{
			name:  "key=value format",
			input: "a.b=hello\nc.d=world\n",
			want: []mergeEntry{
				{key: "a.b", value: "hello"},
				{key: "c.d", value: "world"},
			},
		},
		{
			name:  "key: value format",
			input: "a.b: hello\nc.d: world\n",
			want: []mergeEntry{
				{key: "a.b", value: "hello"},
				{key: "c.d", value: "world"},
			},
		},
		{
			name:  "key: value with YAML quotes",
			input: "a.b: 'quoted value'\nc.d: \"double quoted\"\n",
			want: []mergeEntry{
				{key: "a.b", value: "quoted value"},
				{key: "c.d", value: "double quoted"},
			},
		},
		{
			name: "@reason comment attached to next key",
			input: `# @reason Standard translation
a.b=hello
`,
			want: []mergeEntry{
				{key: "a.b", value: "hello", comment: "# @reason Standard translation"},
			},
		},
		{
			name: "multi-line @reason comment",
			input: `# @reason Standard translation for admin access;
#   kept "sudo" as-is since it's a Unix command
a.b=hello
`,
			want: []mergeEntry{
				{key: "a.b", value: "hello", comment: "# @reason Standard translation for admin access;\n#   kept \"sudo\" as-is since it's a Unix command"},
			},
		},
		{
			name:  "blank lines reset pending comment",
			input: "# @reason this gets discarded\n\na.b=hello\n",
			want: []mergeEntry{
				{key: "a.b", value: "hello"},
			},
		},
		{
			name:  "non-@reason comments are skipped",
			input: "# just a comment\na.b=hello\n",
			want: []mergeEntry{
				{key: "a.b", value: "hello"},
			},
		},
		{
			name:  "YAML separator skipped",
			input: "---\na.b=hello\n",
			want: []mergeEntry{
				{key: "a.b", value: "hello"},
			},
		},
		{
			name:  "invalid key lines ignored",
			input: "not a valid line\na.b=hello\n",
			want: []mergeEntry{
				{key: "a.b", value: "hello"},
			},
		},
		{
			name:  "mixed formats",
			input: "a.b=one\nc.d: two\ne.f: 'three'\n",
			want: []mergeEntry{
				{key: "a.b", value: "one"},
				{key: "c.d", value: "two"},
				{key: "e.f", value: "three"},
			},
		},
		{
			name: "empty input",
			input: "",
			want:  nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseMergeInput(strings.NewReader(tc.input))
			if tc.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %d entries, want %d", len(got), len(tc.want))
			}
			for i := range tc.want {
				if got[i].key != tc.want[i].key {
					t.Errorf("[%d] key = %q, want %q", i, got[i].key, tc.want[i].key)
				}
				if got[i].value != tc.want[i].value {
					t.Errorf("[%d] value = %q, want %q", i, got[i].value, tc.want[i].value)
				}
				if got[i].comment != tc.want[i].comment {
					t.Errorf("[%d] comment = %q, want %q", i, got[i].comment, tc.want[i].comment)
				}
			}
		})
	}
}

func TestMergePreservesExistingComments(t *testing.T) {
	dir := t.TempDir()

	// Simulate a repo structure: translations dir with en-us.yaml and de.yaml.
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enUS := `status:
  checking: Checking...
  updating: Updating...
  done: Done
`
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)

	// Existing de.yaml with @reason comments.
	existingDE := `status:
  # @reason "wird geprüft" = standard German
  checking: Wird geprüft…
  updating: Aktualisieren…
`
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(existingDE), 0644)

	// Merge new input that adds "done" but doesn't touch "checking".
	newInput := `# @reason Standard completion message
status.done=Fertig
`
	inputFile := filepath.Join(dir, "input.txt")
	os.WriteFile(inputFile, []byte(newInput), 0644)

	err := reportMerge(dir, "de", []string{inputFile}, false, "normal", false)
	if err != nil {
		t.Fatal(err)
	}

	// Read the result and verify comments are preserved.
	result, err := loadYAMLWithComments(filepath.Join(transDir, "de.yaml"))
	if err != nil {
		t.Fatal(err)
	}

	// Existing comment preserved.
	if e := result["status.checking"]; e.comment != `# @reason "wird geprüft" = standard German` {
		t.Errorf("existing comment lost: got %q", e.comment)
	}

	// New comment applied.
	if e := result["status.done"]; e.comment != "# @reason Standard completion message" {
		t.Errorf("new comment missing: got %q", e.comment)
	}

	// Uncommented key has no comment.
	if e := result["status.updating"]; e.comment != "" {
		t.Errorf("unexpected comment on updating: got %q", e.comment)
	}
}

func TestMergeDryRunDoesNotWrite(t *testing.T) {
	dir := t.TempDir()

	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)

	existingDE := "status:\n  checking: Wird geprüft…\n"
	dePath := filepath.Join(transDir, "de.yaml")
	os.WriteFile(dePath, []byte(existingDE), 0644)

	// Input adds "done" and overwrites "checking".
	newInput := "status.checking=Prüfe…\nstatus.done=Fertig\n"
	inputFile := filepath.Join(dir, "input.txt")
	os.WriteFile(inputFile, []byte(newInput), 0644)

	// Capture file state before dry run.
	before, _ := os.ReadFile(dePath)

	err := reportMerge(dir, "de", []string{inputFile}, true, "normal", false)
	if err != nil {
		t.Fatal(err)
	}

	// File must be unchanged.
	after, _ := os.ReadFile(dePath)
	if string(after) != string(before) {
		t.Error("dry run modified the locale file")
	}
}

func setupMergeTestRepo(t *testing.T, existingLocale string) (string, string) {
	t.Helper()
	dir := t.TempDir()
	transDir := filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations")
	os.MkdirAll(transDir, 0755)

	enUS := "status:\n  checking: Checking...\n  done: Done\n"
	os.WriteFile(filepath.Join(transDir, "en-us.yaml"), []byte(enUS), 0644)
	os.WriteFile(filepath.Join(transDir, "de.yaml"), []byte(existingLocale), 0644)

	inputFile := filepath.Join(dir, "input.txt")
	return dir, inputFile
}

func TestMergeModeDrift(t *testing.T) {
	existing := `status:
  # @override
  checking: Manuelle Übersetzung
  done: Fertig
`
	dir, inputFile := setupMergeTestRepo(t, existing)
	// Input overwrites both keys.
	os.WriteFile(inputFile, []byte("status.checking=Wird geprüft…\nstatus.done=Erledigt\n"), 0644)

	// Capture stderr for the warning.
	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	err := reportMerge(dir, "de", []string{inputFile}, false, "drift", false)
	w.Close()
	os.Stderr = oldStderr

	if err != nil {
		t.Fatal(err)
	}

	stderrOut, _ := io.ReadAll(r)
	stderr := string(stderrOut)

	// Should warn about overwriting the @override key.
	if !strings.Contains(stderr, "Warning: overwriting @override key status.checking") {
		t.Errorf("expected @override warning, got: %s", stderr)
	}

	// Both keys should be overwritten (drift mode writes everything).
	result, _ := loadYAMLWithComments(filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))
	if result["status.checking"].value != "Wird geprüft…" {
		t.Errorf("override key not overwritten in drift mode: got %q", result["status.checking"].value)
	}
	if result["status.done"].value != "Erledigt" {
		t.Errorf("non-override key not overwritten: got %q", result["status.done"].value)
	}
}

func TestMergeModeImprove(t *testing.T) {
	existing := `status:
  # @override
  checking: Manuelle Übersetzung
  done: Fertig
`
	dir, inputFile := setupMergeTestRepo(t, existing)
	os.WriteFile(inputFile, []byte("status.checking=Wird geprüft…\nstatus.done=Erledigt\n"), 0644)

	err := reportMerge(dir, "de", []string{inputFile}, false, "improve", false)
	if err != nil {
		t.Fatal(err)
	}

	result, _ := loadYAMLWithComments(filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))

	// @override key should be skipped.
	if result["status.checking"].value != "Manuelle Übersetzung" {
		t.Errorf("override key should be preserved in improve mode: got %q", result["status.checking"].value)
	}
	// Non-override key should be overwritten.
	if result["status.done"].value != "Erledigt" {
		t.Errorf("non-override key not overwritten: got %q", result["status.done"].value)
	}
}

func TestMergeModeImproveIncludeOverrides(t *testing.T) {
	existing := `status:
  # @override
  checking: Manuelle Übersetzung
`
	dir, inputFile := setupMergeTestRepo(t, existing)
	os.WriteFile(inputFile, []byte("status.checking=Wird geprüft…\n"), 0644)

	err := reportMerge(dir, "de", []string{inputFile}, false, "improve", true)
	if err != nil {
		t.Fatal(err)
	}

	result, _ := loadYAMLWithComments(filepath.Join(dir, "pkg", "rancher-desktop", "assets", "translations", "de.yaml"))

	// With --include-overrides, even @override keys should be overwritten.
	if result["status.checking"].value != "Wird geprüft…" {
		t.Errorf("override key should be overwritten with --include-overrides: got %q", result["status.checking"].value)
	}
}

func TestMergeModeImproveSkipDryRun(t *testing.T) {
	existing := `status:
  # @override
  checking: Manuelle Übersetzung
  done: Fertig
`
	dir, inputFile := setupMergeTestRepo(t, existing)
	os.WriteFile(inputFile, []byte("status.checking=Wird geprüft…\nstatus.done=Erledigt\n"), 0644)

	// Capture stdout to check dry-run output.
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := reportMerge(dir, "de", []string{inputFile}, true, "improve", false)
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatal(err)
	}

	out, _ := io.ReadAll(r)
	output := string(out)

	// Dry run should report the skip.
	if !strings.Contains(output, "skip status.checking (@override)") {
		t.Errorf("dry-run should show skip, got: %s", output)
	}
	// Non-override key should show overwrite.
	if !strings.Contains(output, "overwrite status.done") {
		t.Errorf("dry-run should show overwrite for non-override key, got: %s", output)
	}
}

func TestExtractTranslationText(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "raw flat text passes through",
			input: "a.b=hello\nc.d=world\n",
			want:  "a.b=hello\nc.d=world\n",
		},
		{
			name: "markdown yaml fence",
			input: `Some text before

` + "```yaml" + `
a.b=hello
c.d=world
` + "```" + `

Some text after
`,
			want: "a.b=hello\nc.d=world\n",
		},
		{
			name: "JSONL agent output",
			input: `{"message":{"role":"user","content":"translate"}}
{"message":{"role":"assistant","content":[{"type":"text","text":"a.b=hello\nc.d=world"}]}}
`,
			// After JSONL extraction, the markdown fence check runs but finds none.
			want: "a.b=hello\nc.d=world\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractTranslationText([]byte(tc.input))
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}
