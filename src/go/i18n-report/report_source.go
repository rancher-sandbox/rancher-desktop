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
	"strings"
)

func runSource(args []string) error {
	fs := flag.NewFlagSet("source", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required, or 'all')")
	force := fs.Bool("force", false, "Refresh @source even when outstanding drift would be erased")
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

	if *locale == localeAll {
		locales, err := translationLocales(root)
		if err != nil {
			return err
		}
		hadDrift := false
		for _, loc := range locales {
			if err := annotateSource(os.Stdout, root, loc, *force); err != nil {
				if !errors.Is(err, errFindings) {
					return err
				}
				hadDrift = true
				continue
			}
			fmt.Printf("Annotated @source for %s\n", loc)
		}
		if hadDrift {
			return findingsError("some locales have outstanding drift; resolve it or pass --force")
		}
		return nil
	}

	if err := annotateSource(os.Stdout, root, *locale, *force); err != nil {
		return err
	}
	fmt.Printf("Annotated @source for %s\n", *locale)
	return nil
}

// annotateSource records the current English source text on every translated
// key of a locale file, as a co-located @source comment. Refreshing an
// existing @source rewrites it to the current English and so erases the record
// of which keys drifted since translation. Guard against that: if any key's
// @source differs from the current English and --force was not given, print
// the drifted keys and return a findings error. Bootstrapping a locale with no
// @source yet is unaffected.
func annotateSource(w io.Writer, root, locale string, force bool) error {
	enKeys, err := loadYAMLFlat(translationsPath(root, sourceLocale+".yaml"))
	if err != nil {
		return err
	}
	localePath := translationsPath(root, locale+".yaml")
	// loadYAMLDocument treats a missing file as empty, so a mistyped
	// locale name would become a new locale file.
	if _, err := os.Stat(localePath); err != nil {
		return err
	}

	doc, err := loadYAMLDocument(localePath)
	if err != nil {
		return err
	}
	localeRoot := documentRoot(doc)

	if !force {
		entries := make(map[string]mergeEntry)
		flattenNodeWithComments("", localeRoot, entries)
		drifted := computeDrifted(enKeys, collectSources(entries), entries)
		if len(drifted) > 0 {
			fmt.Fprintf(w, "%d drifted %s in %s would lose the drift %s:\n",
				len(drifted), plural(len(drifted), "key"), locale, plural(len(drifted), "marker"))
			for _, k := range drifted {
				fmt.Fprintf(w, "  %s\n", k)
			}
			fmt.Fprintf(os.Stderr, "Retranslate the drift (translate --mode=drift then merge --mode=drift) "+
				"or pass --force to overwrite the @source markers anyway.\n")
			return findingsError(fmt.Sprintf("refusing to erase %d outstanding drift %s in %s",
				len(drifted), plural(len(drifted), "marker"), locale))
		}
	}

	annotateNodeSource("", localeRoot, enKeys)

	var buf strings.Builder
	serializeYAMLNode(&buf, doc)
	if err := writeFileAtomic(localePath, []byte(buf.String())); err != nil {
		return fmt.Errorf("writing %s: %w", localePath, err)
	}
	return nil
}
