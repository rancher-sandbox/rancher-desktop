# i18n-report

A CLI tool for maintaining Rancher Desktop's translation files. It scans
source code and YAML locale files to find unused keys, stale translations,
and other i18n issues.

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
a real finding from a broken invocation. Lister commands (`unused`,
`stale`, `references`, `dynamic`) exit `0` even when they list results.

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
| `report_references.go` | `references` subcommand |
| `report_dynamic.go` | `dynamic` subcommand, finds dynamic key patterns |

All files are in `package main`. The tool has one external dependency:
`gopkg.in/yaml.v3`.
