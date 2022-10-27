# nerdctl-stub

This is a stub executable used to launch nerdctl on Windows (and WSL).

## Usage

Use like normal nerdctl, except that some things can be controlled via
environment variables:

Variable | Meaning | Default
--- | --- | ---
RD_WSL_DISTRO | WSL distribution to run in | `rancher-desktop`
RD_NERDCTL | `nerdctl` executable | `/usr/local/bin/nerdctl`
