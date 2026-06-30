package main

import (
	"flag"
	"fmt"
)

func runCheck(args []string) error {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	locale := fs.String("locale", "", "Target locale code (required)")
	policy := fs.String("policy", "", "Policy level: experimental, shipping (optional)")
	fs.Parse(args)

	if *locale == "" {
		return fmt.Errorf("--locale is required")
	}

	if *policy != "" && *policy != "experimental" && *policy != "shipping" {
		return fmt.Errorf("--policy must be experimental or shipping")
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}

	if *policy != "" {
		return reportCheckPolicy(root, *locale, *policy)
	}
	return reportCheckBasic(root, *locale)
}

// reportCheckBasic is the original check: unused, stale, missing counts.
func reportCheckBasic(root, locale string) error {
	enPath := translationsPath(root, "en-us.yaml")
	localePath := translationsPath(root, locale+".yaml")

	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}
	localeKeys, err := loadYAMLFlat(localePath)
	if err != nil {
		return err
	}

	refs, err := findKeyReferences(root, enKeys)
	if err != nil {
		return err
	}

	unusedCount := 0
	for k := range enKeys {
		if _, found := refs[k]; !found {
			unusedCount++
		}
	}

	staleCount := 0
	for k := range localeKeys {
		if _, found := enKeys[k]; !found {
			staleCount++
		}
	}

	missingCount := 0
	for k := range enKeys {
		if _, found := localeKeys[k]; !found {
			missingCount++
		}
	}

	passed := true
	printResult := func(label string, count int) {
		status := "OK"
		if count > 0 {
			status = "FAIL"
			passed = false
		}
		fmt.Printf("  %-30s %3d  %s\n", label+":", count, status)
	}

	printResult("unused keys", unusedCount)
	printResult("stale keys in "+locale, staleCount)
	printResult("keys missing from "+locale, missingCount)

	if passed {
		fmt.Println("All checks passed.")
		return nil
	}
	return fmt.Errorf("checks failed")
}

// reportCheckPolicy runs policy-aware checks on a locale.
//
// Experimental policy:
//   - manifest valid
//   - locale file present
//   - no stale keys
//   - validate passes
//   - metadata coherent
//
// Shipping policy (all of the above plus):
//   - no missing keys
//   - no drifted keys
func reportCheckPolicy(root, locale, policy string) error {
	passed := true
	printResult := func(label string, ok bool, detail string) {
		status := "OK"
		if !ok {
			status = "FAIL"
			passed = false
		}
		if detail != "" {
			fmt.Printf("  %-35s %s  %s\n", label+":", status, detail)
		} else {
			fmt.Printf("  %-35s %s\n", label+":", status)
		}
	}

	fmt.Printf("Policy check (%s) for %s:\n", policy, locale)

	// Manifest valid and locale status matches policy.
	m, manifestErr := loadManifest(root)
	printResult("manifest valid", manifestErr == nil, errString(manifestErr))
	if manifestErr == nil {
		localeInfo, registered := m.Locales[locale]
		if !registered {
			printResult("locale registered in manifest", false, "not found in meta/locales.yaml")
		} else if policy == "shipping" && localeInfo.Status != StatusShipping && localeInfo.Status != StatusSource {
			printResult("locale status matches policy", false,
				fmt.Sprintf("locale status is %q, shipping policy requires \"shipping\" or \"source\"", localeInfo.Status))
		}
	}

	// Locale file present.
	localePath := translationsPath(root, locale+".yaml")
	enPath := translationsPath(root, "en-us.yaml")

	enKeys, err := loadYAMLFlat(enPath)
	if err != nil {
		return err
	}

	localeKeys, localeErr := loadYAMLFlat(localePath)
	printResult("locale file readable", localeErr == nil, errString(localeErr))
	if localeErr != nil {
		localeKeys = make(map[string]string)
	}

	// No stale keys.
	staleCount := 0
	for k := range localeKeys {
		if _, found := enKeys[k]; !found {
			staleCount++
		}
	}
	printResult("no stale keys", staleCount == 0, countDetail(staleCount))

	// Validate passes.
	validateErr := reportValidateQuiet(root, locale)
	printResult("validate passes", validateErr == nil, errString(validateErr))

	// Load metadata for the drift check below. Metadata coherence is already
	// covered by the "validate passes" check above (validateLocale checks it).
	meta, _ := loadMetadata(root, locale)

	// Shipping-only checks.
	if policy == "shipping" {
		// No missing keys.
		missingCount := 0
		for k := range enKeys {
			if _, found := localeKeys[k]; !found {
				missingCount++
			}
		}
		printResult("no missing keys", missingCount == 0, countDetail(missingCount))

		// No drifted keys.
		if meta != nil {
			driftCount := 0
			for k := range localeKeys {
				enValue, inEn := enKeys[k]
				storedSource, inMeta := meta[k]
				if !inEn || !inMeta {
					continue
				}
				if enValue != storedSource {
					driftCount++
				}
			}
			printResult("no drifted keys", driftCount == 0, countDetail(driftCount))
		}
	}

	if passed {
		fmt.Printf("All %s policy checks passed for %s.\n", policy, locale)
		return nil
	}
	return fmt.Errorf("%s policy checks failed for %s", policy, locale)
}

// reportValidateQuiet runs validate and returns an error summary without
// printing individual errors.
func reportValidateQuiet(root, locale string) error {
	errors, err := validateLocale(root, locale)
	if err != nil {
		return err
	}
	if len(errors) > 0 {
		return fmt.Errorf("%d validation errors", len(errors))
	}
	return nil
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func countDetail(count int) string {
	if count == 0 {
		return ""
	}
	return fmt.Sprintf("%d found", count)
}
