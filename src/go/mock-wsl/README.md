# mock-wsl

This is a mock `wsl.exe` that is used in the E2E tests, used to stub out
interaction with the real WSL.

## Configuration

The environment variable `RD_MOCK_WSL_DATA` should be set to the absolute path
of a JSON file describing how the executable should act.  This file will be
modified as part of the run to contain the results and errors.

Please see [`schema.json`](./schema.json) for the JSON schema for the file.
