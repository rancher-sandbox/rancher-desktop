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

## Exit codes

- `0` — success; no problems found.
- `1` — the command found problems in the data, such as undefined
  references.
- `2` — an operational failure: an unreadable file or an invalid flag.

Gate commands (`undefined` and `validate`) split exit `1` from exit `2`,
so CI can tell a real finding from a broken invocation. Lister commands
(`unused`, `stale`, `translate`, `references`, `dynamic`, `untranslated`)
exit `0` even when they list results.

## Annotation conventions

Translation files use YAML comments to carry annotations that the tool reads
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

`@override` must appear on leaf keys only.

A key can have both annotations:

```yaml
# @override
# @reason human-reviewed; "Settings" preferred over "Preferences" for this locale
preferences.title: Settings
```

### `@source`

Records the English source text a translation was made from, so a later
`drift` check can tell when the English has changed. Place it on the line
before the key:

```yaml
# @source Checking...
product.networkStatus.checking: Wird geprüft…
```

A multi-line source repeats the marker, one line per line of English:

```yaml
# @source {count, plural,
# @source   one {# item}
# @source   other {# items}
# @source }
sortableTable.rows: …
```

Unlike `@reason` and `@override`, `@source` is machine-managed: the `source`
command writes it and `merge` refreshes it as it writes each translation, so
do not edit it by hand.

## Subcommands

### unused

Find keys in `en-us.yaml` that no source file references. These keys can
be removed.

```sh
i18n-report unused [--format=json|text]
```

### undefined

Find keys referenced in source code but missing from `en-us.yaml`. These
references render as `%key%` placeholders at runtime, so the command
exits nonzero when any exist.

```sh
i18n-report undefined [--format=json|text]
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

`--format=json` is the machine-readable form: it round-trips through `merge`
without losing multiline values, unlike the text format. Use it whenever the
output feeds another tool.

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
- **JSON array** — `translate --format=json` output; the lossless path
  for multiline values
- **JSONL** — agent transcripts; extracts text from assistant messages
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
include `showErrorBox` calls, port forwarding errors, and template-literal
strings.

### references

Show where each `en-us.yaml` key is used in source code.

```sh
i18n-report references [--format=json|text]
```

### dynamic

Find dynamic key patterns — `t()` calls with template literals — and
show which en-us.yaml keys they match.

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

### source

Record the current English source text on each translated key of a locale, or
`all` locales, as a co-located `# @source` comment. The snapshot lets a later
drift check tell which translations were made from English that has since
changed, without a parallel metadata file.

Refreshing an existing `@source` would overwrite the snapshot with the current
English and erase that record, so when a key has drifted the command refuses
unless `--force`.

```sh
i18n-report source --locale=de
i18n-report source --locale=all
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
- `@source` coverage (every translated key carries a `@source`)

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
```

### Retranslate drifted keys

```sh
i18n-report translate --mode=drift --locale=de > drifted.txt
# Translate the output, then merge:
i18n-report merge --mode=drift --locale=de drifted.out
```

Merge records the new English source for the merged keys itself; do not
run `source` here, since refreshing every `@source` would clear the drift
markers of keys that still await retranslation.

## How it works

### Source scanning

The tool walks `pkg/rancher-desktop/` and root-level source files,
looking for `.vue`, `.ts`, and `.js` files. It skips `node_modules`,
`.git`, `dist`, `vendor`, and `__tests__` directories.

Key references are found by matching several regex patterns:
- `t('key')`, `t("key")`, `` t(`key`) ``, `this.t(...)`, `$t(...)`,
  including calls with the key literal on the following line
- `titleKey`, `descriptionKey`, `labelKey` properties
- `k="..."` and `*-key="..."` Vue template attributes
  (`label-key`, `no-rows-key`, ...)
- `v-t="'key'"` directives
- Indirect references: property values that match en-us.yaml keys

Full-line comments are ignored; trailing comments on code lines are not.

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
1. Reads the existing locale file (which must already exist)
2. Parses each input source (JSON array, JSONL, markdown, or raw flat
   `key=value` / `key: value` lines with `@reason` comments)
3. Merges new entries with existing ones (new overrides old)
4. Writes sorted, nested YAML
5. Records each merged key's English source as a co-located `@source` comment

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
| `compute.go` | Shared key-set computations |
| `source.go` | `@source` comment parsing, English snapshot annotation |
| `report_unused.go` | `unused` subcommand |
| `report_undefined.go` | `undefined` subcommand |
| `report_stale.go` | `stale` subcommand |
| `report_translate.go` | `translate` subcommand |
| `report_merge.go` | `merge` subcommand, input parsing, extraction |
| `report_untranslated.go` | `untranslated` subcommand, heuristic scanner |
| `report_references.go` | `references` subcommand |
| `report_dynamic.go` | `dynamic` subcommand, finds dynamic key patterns |
| `report_remove.go` | `remove` subcommand, YAML key removal |
| `report_source.go` | `source` subcommand |
| `report_validate.go` | `validate` subcommand, placeholder and structure checks |

All files are in `package main`. The tool has one external dependency:
`gopkg.in/yaml.v3`.
