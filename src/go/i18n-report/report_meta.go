package main

import (
	"flag"
	"fmt"
)

func runMeta(args []string) error {
	fs := flag.NewFlagSet("meta", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required, or 'all')")
	fs.Parse(args)

	if *locale == "" {
		return fmt.Errorf("--locale is required (use 'all' for every locale)")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}

	if *locale == "all" {
		m, err := loadManifest(root)
		if err != nil {
			return err
		}
		for _, loc := range m.TranslationLocales() {
			if err := generateMetadata(root, loc.Code); err != nil {
				return err
			}
			fmt.Printf("Generated metadata for %s\n", loc.Code)
		}
		return nil
	}

	if err := generateMetadata(root, *locale); err != nil {
		return err
	}
	fmt.Printf("Generated metadata for %s\n", *locale)
	return nil
}
