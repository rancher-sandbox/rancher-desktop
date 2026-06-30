package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// untranslatedHit records a hardcoded string found in a source file.
type untranslatedHit struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Context string `json:"context"`
}

// Patterns for detecting hardcoded English strings in Vue/TS files.
var (
	// Attributes that should use t() instead of hardcoded strings.
	// Excludes Vue directives (v-tooltip, v-clean-tooltip) since their values are expressions.
	attrPattern = regexp.MustCompile(`(?i)(?:^|\s)(label|legend-text|placeholder|tooltip|description)="([^"]{3,})"`)
	// Skip attributes that are clearly not translatable.
	skipPattern = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$|^\d|^http|^/|^#|^\$|^@|^:|^\{`)
	// Single-word Title Case values (e.g., "Environment", "General").
	singleWordTitleCase = regexp.MustCompile(`^[A-Z][a-z]{2,}$`)
	// Text between an HTML closing ">" and an opening "</" on the same line.
	htmlTextPattern = regexp.MustCompile(`>\s*([A-Z][a-zA-Z ]{2,}?)\s*</`)
	// Bare text between tags split across lines (e.g., ">\n Cancel\n </button>").
	bareTextPattern = regexp.MustCompile(`^[A-Z][a-zA-Z]{2,}(?: [a-zA-Z]+)*$`)
	// Bound string literal attributes, e.g. :label="'Include Kubernetes services'".
	boundLiteralPattern = regexp.MustCompile(`:(label|placeholder)="'([^']{3,})'"`)
	// Validation error messages pushed to an errors array.
	errorPushPattern = regexp.MustCompile(`errors\.push\(\s*['"\x60]`)
)

func runUntranslated(args []string) error {
	fs := flag.NewFlagSet("untranslated", flag.ExitOnError)
	format := fs.String("format", "text", "Output format: text, json")
	includeDescriptions := fs.Bool("include-descriptions", false, "Include 'description' fields (catches diagnostics strings)")
	fs.Parse(args)

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportUntranslated(root, *format, *includeDescriptions)
}

func reportUntranslated(root, format string, includeDescriptions bool) error {
	hits, err := findUntranslated(root, includeDescriptions)
	if err != nil {
		return err
	}

	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(hits)
	}

	if len(hits) == 0 {
		fmt.Println("No untranslated strings found.")
		return nil
	}

	fmt.Printf("Found %d potential untranslated strings:\n\n", len(hits))
	for _, h := range hits {
		fmt.Printf("  %s:%d\n    %s\n\n", h.File, h.Line, h.Context)
	}
	return nil
}

// findUntranslated uses heuristics to find hardcoded English strings in Vue/TS files.
// When includeDescriptions is true, the dialog pattern also matches "description" properties
// (catches diagnostics strings in main/diagnostics/*.ts).
//
// Known gaps: Electron menu labels (main/mainmenu.ts), error dialog calls
// (showErrorBox in tray.ts, settingsImpl.ts), port forwarding error messages
// (backend/kube/client.ts), and template-literal strings lack a reliable
// structural pattern to scan for without drowning in false positives.
func findUntranslated(root string, includeDescriptions bool) ([]untranslatedHit, error) {
	srcDir := filepath.Join(root, "pkg", "rancher-desktop")
	files, err := scanSourceFiles(srcDir, []string{".vue", ".ts", ".js"})
	if err != nil {
		return nil, err
	}

	// Also scan root-level source files (e.g., background.ts).
	if entries, readErr := os.ReadDir(root); readErr == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			ext := filepath.Ext(entry.Name())
			if ext == ".ts" || ext == ".js" {
				files = append(files, filepath.Join(root, entry.Name()))
			}
		}
	}

	var hits []untranslatedHit

	// Electron dialog strings: title/message/detail with hardcoded English.
	dialogFields := "title|message|detail"
	if includeDescriptions {
		dialogFields = "title|message|detail|description"
	}
	dialogPattern := regexp.MustCompile(`(` + dialogFields + `):\s+['"]([A-Z][^'"]{5,})['"]`)

	for _, file := range files {
		base := filepath.Base(file)
		if strings.Contains(base, ".spec.") || strings.Contains(base, ".test.") {
			continue
		}
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		relPath, _ := filepath.Rel(root, file)
		lines := strings.Split(string(data), "\n")
		isVue := strings.HasSuffix(file, ".vue")
		isTS := strings.HasSuffix(file, ".ts")
		inTemplate := false

		for i, line := range lines {
			trimmed := strings.TrimSpace(line)

			// Track top-level Vue <template> sections (not nested slot templates).
			if isVue {
				if trimmed == "<template>" || strings.HasPrefix(trimmed, "<template ") {
					if !inTemplate && (i == 0 || len(line)-len(strings.TrimLeft(line, " \t")) == 0) {
						inTemplate = true
					}
				} else if trimmed == "</template>" && inTemplate {
					if len(line)-len(strings.TrimLeft(line, " \t")) == 0 {
						inTemplate = false
					}
				}
			}

			// Skip lines that already use binding (:attr) or t()
			if strings.Contains(trimmed, ":label=") || strings.Contains(trimmed, ":legend-text=") {
				continue
			}
			if strings.Contains(trimmed, "t(") {
				continue
			}

			found := false

			if isVue {
				// Check unbound attribute values.
				matches := attrPattern.FindAllStringSubmatch(trimmed, -1)
				for _, m := range matches {
					value := m[2]
					if skipPattern.MatchString(value) {
						continue
					}
					if strings.Contains(value, " ") || singleWordTitleCase.MatchString(value) {
						found = true
						break
					}
				}

				// Check text between HTML tags on the same line.
				// Skip <slot> default content — it's fallback text overridden by parents.
				if !found && !strings.Contains(trimmed, "<slot>") {
					tagMatches := htmlTextPattern.FindAllStringSubmatch(trimmed, -1)
					for _, m := range tagMatches {
						value := strings.TrimSpace(m[1])
						if skipPattern.MatchString(value) {
							continue
						}
						found = true
						break
					}
				}

				// Check bare text between tags across lines: previous line
				// ends with ">", this line is bare text, next line starts
				// with "</" or "<".
				if !found && inTemplate && bareTextPattern.MatchString(trimmed) {
					prevEndsWithTag := i > 0 && strings.HasSuffix(strings.TrimSpace(lines[i-1]), ">")
					nextStartsWithTag := i+1 < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i+1]), "<")
					if prevEndsWithTag && nextStartsWithTag {
						found = true
					}
				}

				// Check bound string literal attributes.
				if !found && boundLiteralPattern.MatchString(trimmed) {
					found = true
				}
			}

			if !found && isTS {
				// Validation error messages.
				if errorPushPattern.MatchString(trimmed) {
					found = true
				}
			}

			// Dialog strings in both .vue and .ts files.
			if !found && dialogPattern.MatchString(trimmed) {
				found = true
			}

			if found {
				hits = append(hits, untranslatedHit{
					File:    relPath,
					Line:    i + 1,
					Context: trimmed,
				})
			}
		}
	}
	return hits, nil
}
