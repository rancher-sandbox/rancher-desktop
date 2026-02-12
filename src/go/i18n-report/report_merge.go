package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// mergeEntry holds a translated key-value pair with an optional @reason comment.
type mergeEntry struct {
	key     string
	value   string
	comment string // may be multi-line (joined with "\n")
}

func runMerge(args []string) error {
	fs := flag.NewFlagSet("merge", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	fs.Parse(args)

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportMerge(root, *locale, fs.Args())
}

// reportMerge reads flat key=value pairs with @reason comments and writes
// (or updates) a nested YAML locale file. Input sources:
//   - File arguments: agent output (JSONL), markdown, or raw flat text
//   - Stdin (when no files given): raw flat text
func reportMerge(root, locale string, files []string) error {
	localePath := translationsPath(root, locale+".yaml")

	// Read existing locale entries.
	existing := make(map[string]string)
	if data, err := os.ReadFile(localePath); err == nil {
		var raw map[string]interface{}
		if err := yaml.Unmarshal(data, &raw); err == nil {
			existing = flattenYAML("", raw)
		}
	}

	// Build input reader from file arguments or stdin.
	var inputReader io.Reader
	if len(files) > 0 {
		var combined strings.Builder
		for _, path := range files {
			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading %s: %w", path, err)
			}
			combined.WriteString(extractTranslationText(data))
			combined.WriteString("\n")
		}
		inputReader = strings.NewReader(combined.String())
	} else {
		inputReader = os.Stdin
	}

	// Parse new entries.
	newEntries, err := parseMergeInput(inputReader)
	if err != nil {
		return err
	}

	if len(newEntries) == 0 {
		return fmt.Errorf("no translation entries found in input")
	}

	// Build merged entry list: existing + new (new entries override existing).
	merged := make(map[string]mergeEntry, len(existing)+len(newEntries))
	for k, v := range existing {
		merged[k] = mergeEntry{key: k, value: v}
	}
	added := 0
	for _, e := range newEntries {
		if _, exists := merged[e.key]; !exists {
			added++
		}
		merged[e.key] = e
	}

	// Convert map to sorted slice.
	entries := make([]mergeEntry, 0, len(merged))
	for _, e := range merged {
		entries = append(entries, e)
	}

	// Write nested YAML.
	var buf strings.Builder
	writeNestedYAML(&buf, entries)

	if err := os.WriteFile(localePath, []byte(buf.String()), 0644); err != nil {
		return fmt.Errorf("writing %s: %w", localePath, err)
	}

	fmt.Fprintf(os.Stderr, "Merged %d new keys into %s (total: %d keys)\n", added, localePath, len(entries))
	return nil
}

// extractTranslationText extracts flat translation content from raw bytes.
// It handles three input formats:
//  1. JSONL agent output — parses JSON, extracts text from assistant messages
//  2. Markdown with ```yaml fences — extracts content between fences
//  3. Raw flat key-value text — passed through unchanged
func extractTranslationText(data []byte) string {
	content := string(data)

	// Detect JSONL (agent output): first non-empty line starts with '{'.
	firstLine := ""
	for _, line := range strings.Split(content, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			firstLine = trimmed
			break
		}
	}
	if len(firstLine) > 0 && firstLine[0] == '{' && json.Valid([]byte(firstLine)) {
		var extracted strings.Builder
		for _, line := range strings.Split(content, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || line[0] != '{' {
				continue
			}
			var msg struct {
				Message struct {
					Role    string          `json:"role"`
					Content json.RawMessage `json:"content"`
				} `json:"message"`
			}
			if err := json.Unmarshal([]byte(line), &msg); err != nil {
				continue
			}
			if msg.Message.Role != "assistant" {
				continue
			}
			// Content may be a string or an array of blocks.
			var blocks []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}
			if err := json.Unmarshal(msg.Message.Content, &blocks); err == nil {
				for _, b := range blocks {
					if b.Type == "text" {
						extracted.WriteString(b.Text)
						extracted.WriteString("\n")
					}
				}
			}
		}
		content = extracted.String()
	}

	// Extract content from ```yaml fences if present.
	if strings.Contains(content, "```yaml") {
		var extracted strings.Builder
		inFence := false
		for _, line := range strings.Split(content, "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "```yaml" {
				inFence = true
				continue
			}
			if trimmed == "```" && inFence {
				inFence = false
				continue
			}
			if inFence {
				extracted.WriteString(line)
				extracted.WriteString("\n")
			}
		}
		if extracted.Len() > 0 {
			content = extracted.String()
		}
	}

	return content
}

// parseMergeInput reads flat key=value or key: value lines from a reader,
// collecting @reason comments and associating them with the next key.
// Blank lines and non-@reason comments are skipped.
func parseMergeInput(r io.Reader) ([]mergeEntry, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	var entries []mergeEntry
	var pendingComment strings.Builder

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		// Skip blank lines.
		if trimmed == "" || trimmed == "---" {
			pendingComment.Reset()
			continue
		}

		// Accumulate @reason comments.
		if strings.HasPrefix(trimmed, "# @reason") {
			if pendingComment.Len() > 0 {
				pendingComment.WriteString("\n")
			}
			pendingComment.WriteString(trimmed)
			continue
		}
		// Accumulate continuation lines for multi-line @reason comments.
		if strings.HasPrefix(trimmed, "#   ") && pendingComment.Len() > 0 {
			pendingComment.WriteString("\n")
			pendingComment.WriteString(trimmed)
			continue
		}

		// Skip other comment lines.
		if strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Parse key-value pair: try "key: value" then "key=value".
		var key, value string
		if idx := strings.Index(trimmed, ": "); idx > 0 {
			candidate := trimmed[:idx]
			if isValidDottedKey(candidate) {
				key = candidate
				value = stripYAMLQuotes(trimmed[idx+2:])
			}
		}
		if key == "" {
			if idx := strings.Index(trimmed, "="); idx > 0 {
				candidate := trimmed[:idx]
				if isValidDottedKey(candidate) {
					key = candidate
					value = stripYAMLQuotes(trimmed[idx+1:])
				}
			}
		}

		if key == "" {
			pendingComment.Reset()
			continue
		}

		entries = append(entries, mergeEntry{
			key:     key,
			value:   value,
			comment: pendingComment.String(),
		})
		pendingComment.Reset()
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading input: %w", err)
	}
	return entries, nil
}
