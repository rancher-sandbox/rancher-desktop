# Translations

This directory holds the YAML translation files for Rancher Desktop.

## Files

| File | Purpose |
|------|---------|
| `en-us.yaml` | Canonical English strings (source of truth) |

## Architecture

The renderer (Vuex store `store/i18n.js`) and the main process
(`main/i18n.ts`) both format through `intl-messageformat`, so every key
speaks the same ICU MessageFormat dialect. Both load YAML through
webpack's `js-yaml-loader` at build time via the shared
`utils/translationLoader.ts`.

Webpack auto-discovers locale YAML files in this directory (one file per
locale, named `{code}.yaml`).

The `application.locale` setting controls language selection; the main process
and renderer sync it over IPC.

### Template `t()` function

The i18n plugin (`plugins/i18n.js`) injects a global `t(key, args)`
function into all Vue components. It returns the raw translation;
escaping is the sink's job:

- `{{ t('some.key') }}` — Vue text interpolation escapes itself.
- `v-clean-html="t('some.key')"` — HTML sinks render translator-controlled
  markup; use `v-clean-html` (DOMPurify) when interpolated arguments carry
  data from outside the translation files, and HTML-escape such arguments
  at the call site.

The `<t>` component renders a text child by default; `raw` switches to
innerHTML for strings with entities or markup:

```html
<t k="some.key" raw />
```

The `v-t` directive always renders innerHTML (or sets an attribute with
`v-t:title="'some.key'"`).

A missing key renders as a visible `%some.key%` placeholder in every
process; run `i18n-report undefined` to find such references.

## YAML comment conventions

Add these comments directly above the key they describe.

| Comment | Where | Purpose |
|---------|-------|---------|
| `@context` | en-us.yaml | Where in the UI the string appears |
| `@meaning` | en-us.yaml | Domain-specific meaning when English is ambiguous |
| `@no-translate` | en-us.yaml | Terms that should stay in English by default |
| `@reason` | locale files | Why a particular translation was chosen |

### Examples in en-us.yaml

```yaml
application:
  adminAccess:
    # @context Preferences > Application > General, checkbox label
    # @meaning Administrative privilege escalation for bridged networking and docker socket
    label: Allow to acquire administrative credentials (sudo access)

containerEngine:
  # @context Preferences > Container Engine > General, dropdown label
  # @meaning The OCI runtime (containerd or moby/dockerd), not a JavaScript engine
  label: Container Engine

resetKubernetes:
  # @no-translate Kubernetes
  description: "Run {command} to reset Kubernetes"
```

### Examples in locale files

```yaml
application:
  adminAccess:
    # @reason "Administratorzugriff" is the standard German term for admin access
    #   in software UIs; "sudo" kept untranslated as a Unix command name
    label: Administratorzugriff erlauben (sudo-Zugriff)

containerEngine:
  # @reason "Container-Laufzeit" (container runtime) is more common in German
  #   than a literal translation of "container engine"
  label: Container-Laufzeit
```

## The i18n-report tool

A Go CLI at `src/go/i18n-report/` for translation maintenance. See
`src/go/i18n-report/README.md` for full documentation.

| Subcommand | Description |
|------------|-------------|
| `unused` | Keys in en-us.yaml not referenced in source code |
| `undefined` | Keys referenced in source code but missing from en-us.yaml |
| `stale` | Keys in a locale file absent from en-us.yaml |
| `translate` | Keys missing from a locale, with English values |
| `merge` | Read flat translations, write nested YAML locale file |
| `remove` | Remove keys from translation files (stdin or `--stale`) |
| `untranslated` | Hardcoded English strings in Vue/TS files (heuristic) |
| `references` | Where each en-us.yaml key is used (file:line) |
| `dynamic` | Template literal patterns that reference keys dynamically |
| `check` | source checks, plus per-locale checks with `--locale` |
| `source` | Record each translated key's English source as a `@source` comment |
| `drift` | Detect translated keys whose English source changed |
| `validate` | Structural checks: placeholders, tags, metadata, overrides |

Run from the repository root:

```sh
go tool i18n-report translate --locale=fa
go tool i18n-report translate --locale=fa --batch=1 --batches=3
go tool i18n-report merge --locale=fa agent1.output agent2.output
go tool i18n-report unused --format=json
go tool i18n-report check --locale=de
```

The `merge` subcommand reads flat `key: value` or `key=value` lines, one full
dotted key per line, from plain text, JSON, or agent JSONL transcripts. A YAML
code fence around the lines is stripped as a convenience, but the content
inside must still be flat — nested YAML is not supported, fenced or not.
Without file arguments, it reads from stdin.

## Adding a new language

1. Create an empty locale file `{code}.yaml` in this directory.
2. Register the locale code in four places: en-us.yaml locale names,
   `command-api.yaml` enum, `settingsValidator.ts` `checkEnum`, and
   `settingsValidator.spec.ts` error string.
3. Run `yarn postinstall` to regenerate Go CLI code from the API spec.
4. Run `go tool i18n-report translate --locale={code}` to get keys
   that need translation; translate them and merge with
   `go tool i18n-report merge --locale={code}`.

Webpack discovers new YAML files automatically — no other code changes are
needed.

## Maintenance workflow

1. Remove dead keys from all translation files:
   ```sh
   go tool i18n-report unused | go tool i18n-report remove
   ```
2. Remove stale keys from locale files (keys not in en-us.yaml):
   ```sh
   go tool i18n-report remove --stale
   ```
3. Run `i18n-report translate --locale=<code>` to find keys that need
   translation, then merge the results with `i18n-report merge`.
4. Run `i18n-report untranslated` to find hardcoded English strings in
   Vue/TS files that should be externalized.

CI runs `i18n-report check --locale=all` on every pull request: the
source gate (unused and undefined keys), the locale registration
checks, and each locale's structural checks. Periodic and pre-release
runs add `--strict`, which also requires complete translations (no
missing or drifted keys). Findings exit 1; operational errors exit 2.

## Locale switching

Most UI text updates live when the locale changes (store-driven
templates, application and tray menus, window titles). Labels captured
in a component's `data()` — table headers and row actions — refresh
when navigation remounts the page; this is the accepted pattern, so
prefer `data()` capture over reactive plumbing for new tables.

## Known limitations and deferred work

### Validation messages

`settingsValidator.ts` emits localized error strings, and the CLI and
HTTP API return them directly, so scripts must not parse message text.
In-process callers classify errors through structured flags
(`hasLockedFieldError`); add a flag rather than string matching when a
new category needs classification.

### HTML in translation strings

Several keys embed `<a>` tags with `data-action` or `data-navigate`
attributes that application code relies on. `validate` enforces tag,
`data-*`, and `href` parity, but restructuring these to component
slots would remove the coupling.

### Callback lifecycle

`onLocaleChange()` in `main/i18n.ts` returns an unregister function.
Callers that register during a lifecycle (e.g., tray show) must call
the returned function during teardown (e.g., tray hide) to avoid
leaking callbacks.

### i18n-report tool

- **Registration cross-validation is string-based** for
  settingsValidator.ts and its spec test. Generating those registrations
  from the translation file list would make drift impossible; revisit
  when the next locale is added.

### Scanner gaps

The source scanner (`scan.go`) does not detect translation candidates
in `showErrorBox` calls (`tray.ts`, `settingsImpl.ts`) or port
forwarding error messages (`backend/kube/client.ts`). It also skips
`__tests__` directories, so the `references` report omits test-only
key usage.

### Navigation identifiers

`transientSettings.ts` uses English nav item names as internal
identifiers. These are no longer displayed directly (preference tabs
use `labelKey`), but the internal/display split remains unresolved.
