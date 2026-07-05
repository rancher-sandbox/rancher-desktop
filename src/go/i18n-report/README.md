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

Gate commands (`undefined`) split exit `1` from exit `2`, so CI can tell
a real finding from a broken invocation. Lister commands (`unused`, `stale`,
`translate`, `references`, `dynamic`, `untranslated`) exit `0` even when
they list results.

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

```sh
i18n-report translate --locale=de [--mode=missing] [--format=json|text]
```

`--format=json` is the machine-readable form: it preserves multiline
values, unlike the text format. Use it whenever the output feeds another
tool.

Split the output into parallel batches with `--batch` and `--batches`:

```sh
i18n-report translate --locale=de --batch=1 --batches=3 > batch1.txt
i18n-report translate --locale=de --batch=2 --batches=3 > batch2.txt
i18n-report translate --locale=de --batch=3 --batches=3 > batch3.txt
```

Each batch outputs `key=value` lines suitable for feeding to a translator
or saving to a file.

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

Find dynamic key patterns — `t()` calls with template literals — and
show which en-us.yaml keys they match.

```sh
i18n-report dynamic [--format=json|text]
```

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
| `yaml.go` | YAML flattening |
| `scan.go` | Source file scanning, key reference detection |
| `output.go` | Shared text/JSON output formatter |
| `compute.go` | Shared key-set computations |
| `report_unused.go` | `unused` subcommand |
| `report_undefined.go` | `undefined` subcommand |
| `report_stale.go` | `stale` subcommand |
| `report_translate.go` | `translate` subcommand |
| `report_untranslated.go` | `untranslated` subcommand, heuristic scanner |
| `report_references.go` | `references` subcommand |
| `report_dynamic.go` | `dynamic` subcommand, finds dynamic key patterns |

All files are in `package main`. The tool has one external dependency:
`gopkg.in/yaml.v3`.
