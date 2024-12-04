# spin-stub

This is a stub executable used to launch spin on Windows.

## Usage

Use it as you would with a normal `spin` command. It simply configures the `SPIN_DATA_DIR` environment variable to point to the spin subdirectory within the Rancher Desktop application data directory, and then runs `../internal/spin.exe` (relative to the location of the `spin-stub` binary).
