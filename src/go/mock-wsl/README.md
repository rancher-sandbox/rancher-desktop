# mock-wsl

This is a mock `wsl.exe` that is used in the E2E tests, used to stub out
interaction with the real WSL.

## Configuration

The environment variable `RD_MOCK_WSL_CONFIG` should be set to the absolute path
of a JSON file describing how the executable should act.  This file will be
modified as part of the run.

At the root level, it has the following keys:
Key        | Description
---        | ---
`commands` | Sequence of expected commands; see below for details.
`results`  | Sequence of results; this should be initially empty, and will be filled out.
`errors`   | `[]string`: sequence of errors from unmatched invocations.

### `commands`
Each item in the `commands` sequence can have the following entries;

#### `args`

**Type:** `[]string`

**Required**

The arguments to match.

#### `mode`

**Type:** `"sequential"` | `"repeated"`

**Optional**

If `sequential`, all previous commands must have been matched (at least once)
before this command will match.

If `repeated`, this command may match multiple times; only the results from the
last match will be stored. *Note:* This means that no further commands with the
same `args` will ever match.

If not given, this command can be matched at most once; however, it is
permissible for some of the previous commands to not have been already matched.

#### `stdout`

**Type:** `string`

**Optional**

This will be emitted on standard output.

#### `stderr`

**Type:** `string`

**Optional**

This will be emitted on standard error, after the standard output (if any).

#### `utf16le`

**Type:** `bool`

**Optional**

If given, `stdout` and `stderr` will be converted to UTF-16 LE before
output.

#### `code`

**Type:** `int`

**Optional**

This will be the exit code of the process; if not given, `0` is assumed.

### `results`

The results are a sequence of booleans; an entry will be set to `true` if the
command was run, and `false` otherwise.  This does not need to be given
initially; it will be added.

### `errors`

Errors are a sequence of commands that failed to match.  This does not need to
be given initially; it will be added as needed.
