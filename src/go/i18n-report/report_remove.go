package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func runRemove(args []string) error {
	fs := flag.NewFlagSet("remove", flag.ExitOnError)
	stale := fs.Bool("stale", false, "Remove stale keys from all locale files (keys not in en-us.yaml)")
	fs.Parse(args)

	root, err := repoRoot()
	if err != nil {
		return err
	}

	if *stale {
		return removeStaleKeys(root)
	}

	// Read keys to remove from stdin.
	keys, err := readKeysFromStdin()
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return fmt.Errorf("no valid keys provided on stdin")
	}

	keySet := make(map[string]bool, len(keys))
	for _, k := range keys {
		keySet[k] = true
	}

	targets, err := findTranslationFiles(root)
	if err != nil {
		return err
	}

	for _, path := range targets {
		removed, err := removeKeysFromFile(path, keySet)
		if err != nil {
			return err
		}
		if removed > 0 {
			relPath, _ := filepath.Rel(root, path)
			fmt.Fprintf(os.Stderr, "Removed %d keys from %s\n", removed, relPath)
			locale := strings.TrimSuffix(filepath.Base(path), ".yaml")
			if err := removeMetadataKeys(root, locale, keySet); err != nil {
				return err
			}
		}
	}

	return nil
}

// removeStaleKeys removes keys from each non-en-us locale file that
// do not exist in en-us.yaml.
func removeStaleKeys(root string) error {
	enPath := translationsPath(root, "en-us.yaml")
	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	targets, err := findTranslationFiles(root)
	if err != nil {
		return err
	}

	for _, path := range targets {
		if filepath.Base(path) == "en-us.yaml" {
			continue
		}

		localeKeys, err := loadYAMLFlat(path)
		if err != nil {
			return err
		}

		staleKeys := make(map[string]bool)
		for k := range localeKeys {
			if _, found := enKeys[k]; !found {
				staleKeys[k] = true
			}
		}

		if len(staleKeys) == 0 {
			continue
		}

		removed, err := removeKeysFromFile(path, staleKeys)
		if err != nil {
			return err
		}
		relPath, _ := filepath.Rel(root, path)
		fmt.Fprintf(os.Stderr, "Removed %d stale keys from %s\n", removed, relPath)
		locale := strings.TrimSuffix(filepath.Base(path), ".yaml")
		if err := removeMetadataKeys(root, locale, staleKeys); err != nil {
			return err
		}
	}

	return nil
}

// readKeysFromStdin reads dotted translation keys from stdin, one per line.
// Lines that are not valid dotted keys are skipped, so the output of
// `unused` or `stale` can be piped directly.
func readKeysFromStdin() ([]string, error) {
	var keys []string
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		key := strings.TrimSpace(scanner.Text())
		if isValidDottedKey(key) {
			keys = append(keys, key)
		}
	}
	return keys, scanner.Err()
}

// findTranslationFiles returns paths to all YAML files in the translations
// directory. Matches any .yaml file; sufficient for current naming conventions.
func findTranslationFiles(root string) ([]string, error) {
	dir := filepath.Join(root, translationsDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", dir, err)
	}
	var paths []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".yaml") {
			paths = append(paths, filepath.Join(dir, e.Name()))
		}
	}
	return paths, nil
}

// removeKeysFromFile removes the given dotted keys from a YAML file,
// pruning empty parent nodes. Returns the number of keys removed.
func removeKeysFromFile(path string, keys map[string]bool) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return 0, fmt.Errorf("parsing %s: %w", path, err)
	}

	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return 0, nil
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return 0, nil
	}

	removed := 0
	for key := range keys {
		if removeKeyFromNode(root, strings.Split(key, ".")) {
			removed++
		}
	}

	if removed == 0 {
		return 0, nil
	}

	var buf strings.Builder
	serializeYAMLNode(&buf, &doc)

	if err := os.WriteFile(path, []byte(buf.String()), 0644); err != nil {
		return 0, fmt.Errorf("writing %s: %w", path, err)
	}

	return removed, nil
}

// removeKeyFromNode removes a dotted key path from a mapping node,
// pruning empty parents. Returns true if the key was found and removed.
func removeKeyFromNode(node *yaml.Node, parts []string) bool {
	if node.Kind != yaml.MappingNode || len(parts) == 0 {
		return false
	}

	for i := 0; i < len(node.Content)-1; i += 2 {
		keyNode := node.Content[i]
		valNode := node.Content[i+1]

		if keyNode.Value != parts[0] {
			continue
		}

		if len(parts) == 1 {
			// Remove this key-value pair.
			node.Content = append(node.Content[:i], node.Content[i+2:]...)
			return true
		}

		// Recurse into nested mapping.
		if removeKeyFromNode(valNode, parts[1:]) {
			// Prune empty parent.
			if valNode.Kind == yaml.MappingNode && len(valNode.Content) == 0 {
				node.Content = append(node.Content[:i], node.Content[i+2:]...)
			}
			return true
		}
	}
	return false
}
