# i18n-report

A CLI tool for maintaining Rancher Desktop's translation files. It scans
source code and YAML locale files to find unused keys, missing translations,
hardcoded English strings, and other i18n issues.

## Quick start

Run from the repository root:

```sh
go tool i18n-report <subcommand> [flags]
```

Or build and run the binary:

```sh
go build -o src/go/i18n-report/i18n-report ./src/go/i18n-report
./src/go/i18n-report/i18n-report <subcommand> [flags]
```

## Annotation conventions

Translation files use YAML comments to carry metadata that the tool reads
and preserves during merge operations.

### `@reason`

Explains why a particular translation was chosen. Place on the line before
the key:

```yaml
# @reason "Checking" is clearer than "Verifying" in this context
product.networkStatus.checking: Checking...
```

Multi-line reasons use `#` continuation lines:

```yaml
# @reason Matches the label used in Kubernetes documentation;
#   kept short to fit the status bar
product.networkStatus.online: Online
```

The `merge` command preserves `@reason` comments on existing keys and
attaches them to new keys when present in the input.

### `@override`

Marks a translation as intentionally different from what an automated
translator would produce. Place on the line before the key:

```yaml
# @override
product.networkStatus.checking: Verifying...
```

`@override` affects three subcommands:

- **`translate --mode=improve`** skips `@override` keys (they need no
  improvement). Pass `--include-overrides` to include them anyway.
- **`merge --mode=drift`** warns before overwriting `@override` keys,
  since the translator chose that wording deliberately.
- **`merge --mode=improve`** skips `@override` keys by default.
  Pass `--include-overrides` to overwrite them.

`@override` must appear on leaf keys only. The `validate` command
reports `@override` on parent mapping nodes as an error.

A key can have both annotations:

```yaml
# @override
# @reason human-reviewed; "Settings" preferred over "Preferences" for this locale
preferences.title: Settings
```

## Subcommands

### unused

Find keys in `en-us.yaml` that no source file references. These keys can
be removed.

```sh
i18n-report unused [--format=json|text]
```

### missing

Find keys in `en-us.yaml` absent from a target locale file.

```sh
i18n-report missing --locale=de [--format=json|text]
```

### stale

Find keys in a locale file absent from `en-us.yaml`. These keys are
obsolete and should be removed.

```sh
i18n-report stale --locale=de [--format=json|text]
```

### translate

List keys that need translation, with their English values.

Modes:
- **`missing`** (default) — keys absent from the locale file
- **`improve`** — keys already translated but eligible for quality review
  (skips `@override` keys unless `--include-overrides` is set)
- **`drift`** — keys whose English source changed since last translation

```sh
i18n-report translate --locale=de [--mode=missing] [--format=json|text]
```

Split the output into parallel batches with `--batch` and `--batches`:

```sh
i18n-report translate --locale=de --batch=1 --batches=3 > batch1.txt
i18n-report translate --locale=de --batch=2 --batches=3 > batch2.txt
i18n-report translate --locale=de --batch=3 --batches=3 > batch3.txt
```

Each batch outputs `key=value` lines suitable for feeding to a translator
or saving to a file.

### merge

Read flat translations and write (or update) a nested YAML locale file.
Accepts file arguments or reads from stdin.

```sh
i18n-report merge --locale=de batch1.out batch2.out batch3.out
i18n-report merge --locale=de < translations.txt
i18n-report merge --locale=de --dry-run batch1.out   # preview without writing
```

Input formats detected automatically:
- **JSONL** — extracts text from JSON objects with `key` and `value` fields
- **Markdown with `` ```yaml `` fences** — extracts content between fences
- **Raw flat text** — `key=value` or `key: value` lines passed through

Merge modes control how `@override` keys are handled:
- **`normal`** (default) — overwrite everything
- **`drift`** — warn before overwriting `@override` keys
- **`improve`** — skip `@override` keys (pass `--include-overrides` to
  overwrite them)

The merge command preserves existing translations, adds new keys, and
maintains `@reason` comments. Use `--dry-run` to preview changes without
writing.

### untranslated

Scan Vue and TypeScript files for hardcoded English strings that should
use `t()` calls.

```sh
i18n-report untranslated [--format=json|text] [--include-descriptions]
```

The `--include-descriptions` flag extends the scan to `description`
properties, catching diagnostics strings in `main/diagnostics/*.ts`.

This report uses heuristics and may produce false positives. Known gaps
include Electron menu labels, `showErrorBox` calls, port forwarding errors,
and template-literal strings.

### references

Show where each `en-us.yaml` key is used in source code.

```sh
i18n-report references [--format=json|text]
```

### dynamic

Find dynamic key patterns — `t()` calls with template literals or
concatenation — and show which en-us.yaml keys they match.

```sh
i18n-report dynamic [--format=json|text]
```

### remove

Remove keys from translation files. Two modes:

**Pipe mode** — reads dotted keys from stdin and removes them from all
translation files (en-us.yaml and every locale):

```sh
i18n-report unused | i18n-report remove
```

Non-key lines (headers, blank lines) are filtered out automatically, so
the output of `unused` or `stale` can be piped directly.

**Stale mode** — removes keys from each locale file that do not exist in
en-us.yaml:

```sh
i18n-report remove --stale
```

### validate

Check structural correctness of translations in a locale file.

```sh
i18n-report validate --locale=de
```

Checks include:
- Placeholder parity (`{name}`, `{count}`) between English and locale
- ICU MessageFormat structure (plural/select branch names)
- HTML tag preservation (`<a>`, `<b>`, etc.)
- `data-*` attribute preservation (runtime handlers depend on these)
- `@override` placement (leaf keys only)
- Metadata coherence (every translated key has a metadata entry)

### drift

Detect keys whose English source text changed since last translation.
Compares current `en-us.yaml` values against stored metadata.

```sh
i18n-report drift --locale=de
```

Exits with code 1 when drift is detected.

### meta

Generate or regenerate source-text metadata for a locale. The metadata
records the English text at translation time, enabling drift detection.

```sh
i18n-report meta --locale=de
```

### manifest

Cross-validate locale registrations across the codebase.

```sh
i18n-report manifest
```

Checks that `meta/locales.yaml`, `command-api.yaml`, `settingsValidator.ts`,
and `settingsValidator.spec.ts` agree on the set of supported locales.

### check

Run multiple checks together. Exits with code 1 on any failure.

Without `--policy`, runs basic checks (unused, stale, missing):

```sh
i18n-report check --locale=de
```

With `--policy`, runs policy-appropriate checks:

```sh
i18n-report check --policy=experimental --locale=de
i18n-report check --policy=shipping --locale=de
```

**Experimental** policy checks: manifest valid, locale file readable,
no stale keys, validate passes, metadata coherent.

**Shipping** policy adds: no missing keys, no drifted keys.

## Common workflows

### Clean up dead keys

```sh
i18n-report unused | i18n-report remove   # remove from all files
i18n-report remove --stale                # remove locale-only leftovers
```

### Translate missing keys

```sh
# Generate key=value output for translators.
i18n-report translate --locale=de --batch=1 --batches=3 > batch1.txt
i18n-report translate --locale=de --batch=2 --batches=3 > batch2.txt
i18n-report translate --locale=de --batch=3 --batches=3 > batch3.txt

# Merge translated output back into the locale file.
i18n-report merge --locale=de batch1.out batch2.out batch3.out

# Verify the result.
i18n-report check --locale=de
```

### Retranslate drifted keys

```sh
i18n-report translate --mode=drift --locale=de > drifted.txt
# Translate the output, then merge:
i18n-report merge --mode=drift --locale=de drifted.out
i18n-report meta --locale=de    # regenerate metadata
```

## How it works

### Source scanning

The tool walks `pkg/rancher-desktop/` and root-level source files,
looking for `.vue`, `.ts`, and `.js` files. It skips `node_modules`,
`.git`, `dist`, `vendor`, and `__tests__` directories.

Key references are found by matching several regex patterns:
- `t('key')`, `t("key")`, `` t(`key`) ``, `this.t(...)`, `$t(...)`
- `titleKey`, `descriptionKey`, `labelKey` properties
- `label-key="..."` Vue template attributes
- Indirect references: property values that match en-us.yaml keys

### Untranslated heuristics

The untranslated scanner checks:
- Unbound HTML attributes (`label="..."`, `placeholder="..."`, etc.)
- Text between HTML tags (same line and cross-line)
- Bound string literal attributes (`:label="'text'"`)
- Electron dialog properties (`title`, `message`, `detail`)
- Validation error messages (`errors.push('...')`)

It skips test files, lines already using `t()` or bound attributes, and
values matching common non-translatable patterns (URLs, CSS classes,
identifiers).

### Merge pipeline

The merge command:
1. Reads existing locale file (if any)
2. Extracts flat text from input files (handling JSONL, markdown, raw)
3. Parses `key=value` or `key: value` lines with `@reason` comments
4. Merges new entries with existing ones (new overrides old)
5. Writes sorted, nested YAML with blank lines between top-level groups
6. Generates source-text metadata alongside the locale file

## Development

### Running tests

```sh
go test ./src/go/i18n-report/...
```

### File layout

| File | Contents |
|------|----------|
| `main.go` | Subcommand dispatch, usage text |
| `repo.go` | Repository root detection, path helpers |
| `yaml.go` | YAML flattening, scalar formatting, nested writer |
| `scan.go` | Source file scanning, key reference detection |
| `output.go` | Shared text/JSON output formatter |
| `manifest.go` | Locale manifest types, `meta/locales.yaml` loader |
| `metadata.go` | Metadata file I/O, English source-string snapshots |
| `report_unused.go` | `unused` subcommand |
| `report_missing.go` | `missing` subcommand |
| `report_stale.go` | `stale` subcommand |
| `report_translate.go` | `translate` subcommand |
| `report_merge.go` | `merge` subcommand, input parsing, extraction |
| `report_untranslated.go` | `untranslated` subcommand, heuristic scanner |
| `report_references.go` | `references` subcommand |
| `report_dynamic.go` | `dynamic` subcommand, finds dynamic key patterns |
| `report_remove.go` | `remove` subcommand, YAML key removal |
| `report_validate.go` | `validate` subcommand, placeholder and structure checks |
| `report_drift.go` | `drift` subcommand, detects stale translations |
| `report_meta.go` | `meta` subcommand, source-string metadata generation |
| `report_manifest.go` | `manifest` subcommand, cross-validation with API spec |
| `report_check.go` | `check` subcommand |

All files are in `package main`. The tool has one external dependency:
`gopkg.in/yaml.v3`.
