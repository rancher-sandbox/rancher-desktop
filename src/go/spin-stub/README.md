# spin-stub

This is a stub executable used to launch spin on Windows.

## Usage

Use like normal spin. It just sets up `SPIN_DATA_DIR` to point to the `spin` subdirectory in the Rancher Desktop application data directory and then invokes `../internal/spin.exe` (relative to the location of the `spin-stub` binary).
