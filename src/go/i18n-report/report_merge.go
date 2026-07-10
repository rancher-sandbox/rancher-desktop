// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

// modeNormal is merge-only; the shared modes live with translate.
const modeNormal = "normal"

// looksLikeEntry matches lines that were probably meant as key-value
// entries, so their silent loss can be reported. Report header lines
// ("Found 15 keys ...") contain spaces before the separator and stay quiet.
var looksLikeEntry = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]*\s*[:=]`)

func runMerge(args []string) error {
	fs := flag.NewFlagSet("merge", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	dryRun := fs.Bool("dry-run", false, "Show what would change without writing")
	mode := fs.String("mode", modeNormal, "Merge mode: normal, drift, improve")
	includeOverrides := fs.Bool("include-overrides", false, "In improve mode, also overwrite @override keys")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	validModes := map[string]bool{modeNormal: true, modeDrift: true, modeImprove: true}
	if !validModes[*mode] {
		return fmt.Errorf("--mode must be normal, drift, or improve")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	return reportMerge(os.Stdout, root, *locale, fs.Args(), *dryRun, *mode, *includeOverrides)
}

// reportMerge reads translated entries and updates a nested YAML locale
// file. It operates on the yaml.Node tree directly, preserving all existing
// leaf comments. File arguments and stdin accept the same auto-detected
// formats (see parseInputData).
//
// Merge modes control how @override keys are handled:
//   - normal: write everything unconditionally
//   - drift: write everything, warn when overwriting @override keys
//   - improve: skip @override keys unless includeOverrides is set
func reportMerge(w io.Writer, root, locale string, files []string, dryRun bool, mode string, includeOverrides bool) error {
	localePath := translationsPath(root, locale+".yaml")

	// A missing locale file is a mistyped --locale until proven otherwise;
	// adding a language starts by creating the empty file (see README).
	if _, err := os.Stat(localePath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("locale file %s does not exist; create it first (see the translations README)", localePath)
		}
		return err
	}

	doc, err := loadYAMLDocument(localePath)
	if err != nil {
		return fmt.Errorf("loading existing %s: %w", localePath, err)
	}
	treeRoot := documentRoot(doc)
	if err := validateNoAliases(treeRoot); err != nil {
		return fmt.Errorf("%s: %w", localePath, err)
	}

	// Parse new entries from file arguments or stdin.
	var newEntries []mergeEntry
	if len(files) > 0 {
		for _, path := range files {
			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading %s: %w", path, err)
			}
			entries, err := parseInputData(data)
			if err != nil {
				return fmt.Errorf("parsing %s: %w", path, err)
			}
			newEntries = append(newEntries, entries...)
		}
	} else {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return fmt.Errorf("reading stdin: %w", err)
		}
		newEntries, err = parseInputData(data)
		if err != nil {
			return err
		}
	}

	if len(newEntries) == 0 {
		return fmt.Errorf("no translation entries found in input")
	}

	// Reject conflicting duplicate keys in input.
	seen := make(map[string]string, len(newEntries))
	for _, e := range newEntries {
		if prev, exists := seen[e.key]; exists && prev != e.value {
			return fmt.Errorf("conflicting values for key %q in input:\n  first:  %s\n  second: %s", e.key, prev, e.value)
		}
		seen[e.key] = e.value
	}

	// Reject keys not present in the English source.
	enPath := translationsPath(root, "en-us.yaml")
	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return fmt.Errorf("loading source keys: %w", err)
	}
	var unknown []string
	for _, e := range newEntries {
		if _, exists := enKeys[e.key]; !exists {
			unknown = append(unknown, e.key)
		}
	}
	if len(unknown) > 0 {
		return fmt.Errorf("input contains %d keys not in en-us.yaml: %s", len(unknown), strings.Join(unknown, ", "))
	}

	// Apply new entries to the tree, respecting mode.
	var added, overwritten, skipped, warned int
	var applied []string
	for _, e := range newEntries {
		existingVal, _, found := nodeGetLeaf(treeRoot, e.key)
		if found {
			hasOverride := nodeHasOverride(treeRoot, e.key)

			// In improve mode, skip @override keys unless --include-overrides.
			if mode == modeImprove && hasOverride && !includeOverrides {
				skipped++
				if dryRun {
					fmt.Fprintf(w, "skip %s (@override)\n", e.key)
				}
				continue
			}

			if existingVal != e.value {
				overwritten++
				if dryRun {
					fmt.Fprintf(w, "overwrite %s\n  old: %s\n  new: %s\n", e.key, existingVal, e.value)
				}
				// In drift mode, warn when overwriting @override keys.
				if mode == modeDrift && hasOverride {
					warned++
					fmt.Fprintf(os.Stderr, "Warning: overwriting @override key %s\n", e.key)
				}
			}
		} else {
			added++
			if dryRun {
				fmt.Fprintf(w, "add %s: %s\n", e.key, e.value)
			}
		}
		applied = append(applied, e.key)
		if !dryRun {
			if err := nodeSetLeaf(treeRoot, e.key, e.value, e.comment); err != nil {
				return fmt.Errorf("setting %s: %w", e.key, err)
			}
		}
	}

	if dryRun {
		total := len(nodeAllLeaves(treeRoot)) + added
		fmt.Fprintf(os.Stderr, "Dry run: %d new, %d overwritten", added, overwritten)
		if skipped > 0 {
			fmt.Fprintf(os.Stderr, ", %d skipped (@override)", skipped)
		}
		if warned > 0 {
			fmt.Fprintf(os.Stderr, ", %d @override warnings", warned)
		}
		fmt.Fprintf(os.Stderr, ", %d total\n", total)
		return nil
	}

	// Record the English source each applied key was translated from, as a
	// co-located @source comment. Only applied keys are touched; refreshing
	// @source on keys this merge skipped would erase their drift markers.
	for _, key := range applied {
		en, ok := enKeys[key]
		if !ok {
			continue
		}
		val, comment, found := nodeGetLeaf(treeRoot, key)
		if !found {
			continue
		}
		if err := nodeSetLeaf(treeRoot, key, val, setSourceComment(comment, en)); err != nil {
			return fmt.Errorf("recording @source for %s: %w", key, err)
		}
	}

	// Serialize before writing, so a serialization failure leaves the file
	// untouched. @source lives in the same file, so one atomic write keeps a
	// translation and its snapshot in sync.
	var buf strings.Builder
	serializeYAMLNode(&buf, doc)
	localeData := []byte(buf.String())

	total := len(nodeAllLeaves(treeRoot))

	if err := writeFileAtomic(localePath, localeData); err != nil {
		return fmt.Errorf("writing %s: %w", localePath, err)
	}

	fmt.Fprintf(os.Stderr, "Merged %d new keys into %s (%d overwritten", added, localePath, overwritten)
	if skipped > 0 {
		fmt.Fprintf(os.Stderr, ", %d skipped", skipped)
	}
	if warned > 0 {
		fmt.Fprintf(os.Stderr, ", %d @override warnings", warned)
	}
	fmt.Fprintf(os.Stderr, ", %d total)\n", total)
	return nil
}

// parseInputData converts one input source (file or stdin) into merge
// entries. A JSON array in the `translate --format=json` shape is the
// lossless path for multiline values; everything else goes through the
// line-based text formats.
func parseInputData(data []byte) ([]mergeEntry, error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		var pairs []struct {
			Key     string `json:"key"`
			Value   string `json:"value"`
			Comment string `json:"comment"`
		}
		if err := json.Unmarshal(trimmed, &pairs); err != nil {
			return nil, fmt.Errorf("parsing JSON array input: %w", err)
		}
		entries := make([]mergeEntry, 0, len(pairs))
		for _, p := range pairs {
			entries = append(entries, mergeEntry{key: p.Key, value: p.Value, comment: localeCommentLines(p.Comment)})
		}
		return entries, nil
	}
	return parseMergeInput(strings.NewReader(extractTranslationText(data)))
}

// localeCommentLines keeps only comment lines that belong on the locale key
// (@reason and @override), matching the flat parser. The translate report
// carries en-us annotations (@context, @meaning) whose home is the source
// file, not the locale file.
func localeCommentLines(comment string) string {
	var kept []string
	for _, line := range strings.Split(comment, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# @reason") || strings.HasPrefix(trimmed, "# @override") {
			kept = append(kept, trimmed)
		}
	}
	return strings.Join(kept, "\n")
}

// extractTranslationText extracts flat translation content from raw bytes.
// It handles three input formats:
//  1. JSONL agent output — parses JSON, extracts text from assistant messages
//  2. Markdown with ```yaml fences — extracts content between fences
//  3. Raw flat key-value text — passed through unchanged
func extractTranslationText(data []byte) string {
	content := string(data)

	// Detect JSONL by checking whether the first non-whitespace character is '{'.
	// Sufficient for the agent output formats we consume.
	firstLine := ""
	for _, line := range strings.Split(content, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			firstLine = trimmed
			break
		}
	}
	if firstLine != "" && firstLine[0] == '{' && json.Valid([]byte(firstLine)) {
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
			// Content may be a string or an array of content blocks.
			var text string
			if err := json.Unmarshal(msg.Message.Content, &text); err == nil {
				extracted.WriteString(text)
				extracted.WriteString("\n")
			} else {
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
// maxLineBytes bounds a single input line; agent transcripts embed whole
// documents on one JSONL line.
const maxLineBytes = 1024 * 1024

func parseMergeInput(r io.Reader) ([]mergeEntry, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, maxLineBytes), maxLineBytes)

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

		// Accumulate @reason and @override comments; both belong on the
		// locale key. An input @override marks the key as hand-tuned so
		// later improve/merge passes leave it alone.
		if strings.HasPrefix(trimmed, "# @reason") || strings.HasPrefix(trimmed, "# @override") {
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
			if looksLikeEntry.MatchString(trimmed) {
				fmt.Fprintf(os.Stderr, "Warning: ignoring unparseable input line: %s\n", trimmed)
			}
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
