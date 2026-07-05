// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
)

func runMeta(args []string) error {
	fs := flag.NewFlagSet("meta", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required, or 'all')")
	force := fs.Bool("force", false, "Regenerate even when outstanding drift would be erased")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *locale == "" {
		return fmt.Errorf("--locale is required (use 'all' for every locale)")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}

	if *locale == "all" {
		locales, err := translationLocales(root)
		if err != nil {
			return err
		}
		hadDrift := false
		for _, loc := range locales {
			if err := regenerateMetadata(os.Stdout, root, loc, *force); err != nil {
				if !errors.Is(err, errFindings) {
					return err
				}
				hadDrift = true
				continue
			}
			fmt.Printf("Generated metadata for %s\n", loc)
		}
		if hadDrift {
			return findingsError("some locales have outstanding drift; resolve it or pass --force")
		}
		return nil
	}

	if err := regenerateMetadata(os.Stdout, root, *locale, *force); err != nil {
		return err
	}
	fmt.Printf("Generated metadata for %s\n", *locale)
	return nil
}

// regenerateMetadata writes metadata for a locale. When a metadata file
// already exists, regenerating it would rewrite every entry to the current
// English source and so erase the drift markers that record which keys still
// await retranslation. Guard against that: if any drifted key is outstanding
// and --force was not given, print the drifted keys and return a findings
// error. Bootstrapping a locale that has no metadata file yet is unaffected.
func regenerateMetadata(w io.Writer, root, locale string, force bool) error {
	metaPath := metadataPath(root, locale)
	if _, err := os.Stat(metaPath); err == nil && !force {
		enKeys, err := loadYAMLFlat(translationsPath(root, "en-us.yaml"))
		if err != nil {
			return err
		}
		localeKeys, err := loadYAMLFlat(translationsPath(root, locale+".yaml"))
		if err != nil {
			return err
		}
		meta, err := loadMetadata(root, locale)
		if err != nil {
			return err
		}
		drifted := computeDrifted(enKeys, meta, localeKeys)
		if len(drifted) > 0 {
			fmt.Fprintf(w, "%d drifted keys in %s would lose their drift marker:\n", len(drifted), locale)
			for _, k := range drifted {
				fmt.Fprintf(w, "  %s\n", k)
			}
			fmt.Fprintf(os.Stderr, "Retranslate the drift (translate --mode=drift then merge --mode=drift) "+
				"or pass --force to overwrite the metadata anyway.\n")
			return findingsError(fmt.Sprintf("refusing to erase %d outstanding drift markers in %s", len(drifted), locale))
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}

	return generateMetadata(root, locale)
}
