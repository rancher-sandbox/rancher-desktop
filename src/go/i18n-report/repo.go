package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const translationsDir = "pkg/rancher-desktop/assets/translations"

// repoRoot returns the repository root by walking up from the current
// directory looking for package.json.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not find repository root (no package.json found)")
		}
		dir = parent
	}
}

// translationsPath returns the absolute path to a file in the translations directory.
func translationsPath(root, filename string) string {
	return filepath.Join(root, translationsDir, filename)
}
