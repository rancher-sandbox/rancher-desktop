package main

import (
	"fmt"
)

func runManifest(args []string) error {
	root, err := repoRoot()
	if err != nil {
		return err
	}

	m, err := loadManifest(root)
	if err != nil {
		return err
	}

	fmt.Printf("Source locale: %s\n", m.SourceLocale())
	fmt.Println("Translation locales:")
	for _, loc := range m.TranslationLocales() {
		fmt.Printf("  %-12s %s\n", loc.Code, loc.Status)
	}
	fmt.Println("Manifest valid.")
	return nil
}
