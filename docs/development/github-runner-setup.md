# Setting up Self-Hosted GitHub Actions Runners

This document aims to collect information on setting up GitHub Actions runners
for use with Rancher Desktop.

## Windows

### Prerequisites

The runner configuration we have tested is:

- Windows 11 (including updates)
- The machine needs at least 10G of memory

### Configuration

Some steps must be run as administrator (and others done as the unprivileged
account that will be used to run tasks); they will be labeled as follows:

Icon | Context
--- | ---
:baby: | Unprivileged user
:mage: | Administrator

1. :mage: Set up the unprivileged user. A password is required.
1. :mage: Install [Microsoft Visual Studio].
    - Please refer to [top-level instructions] for the required components.
1. :baby: Manually create `~/.npmrc` (note that the second line is long and may
    be wrapped for display):
    ```
    msvs_version=2022
    msbuild_path=C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe
    ```
1. :baby: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
1. :baby: Install [Scoop]
1. :baby: Install `git`, `unzip`, `python`
    - `scoop install git unzip python`
    - `actions/setup-python` [requires admin] so we're using Scoop-installed
      Python instead.
1. :mage: Manually install WSL
    - `wsl --install --inbox --enable-wsl1 --no-distribution`
    - The Microsoft Store version of WSL must **not** be installed.
        - Check with `Get-AppPackage -Name *Linux*` (for *both* accounts)
        - If found, uninstall with `Get-AppPackage -Name *Linux* | Remove-AppPackage`
1. :mage: Reboot the machine to finish WSL installation.
1. :mage: Install GitHub Actions runner following [instructions] (on the page to
   add a runner, not the help documentation).
    - The default runner group, labels, work folder, etc. are fine.
    - Install the runner as a service.
    - Run the service as the standard user :baby: created above.

    Sample output:
    ```
    Would you like to run the runner as service? (Y/N) [press Enter for N] y
    User account to use for the service [press Enter for NT AUTHORITY\NETWORK SERVICE] Joe
    Password for the account MACHINE-NAME\Joe *********
    Granting file permissions to 'MACHINE-NAME\Joe'.
    Service actions.runner.… successfully installed
    Service actions.runner.… successfully set recovery option
    Service actions.runner.… successfully set to delayed auto start
    Service actions.runner.… successfully configured
    ```

[Microsoft Visual Studio]: https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community
[top-level instructions]: https://github.com/rancher-sandbox/rancher-desktop#manual-development-environment-setup
[Scoop]: https://github.com/ScoopInstaller/Install#typical-installation
[requires admin]: https://github.com/actions/setup-python/blob/main/docs/advanced-usage.md#windows
[instructions]: https://github.com/rancher-sandbox/rancher-desktop/settings/actions/runners/new?arch=x64&os=win

## Linux

### Prerequisites

- A host machine with `qemu-system-x86_64` (ideally with working KVM
  acceleration).
- A minimum of 6GB of RAM per ephemeral worker (plus overhead).

### Configuration

1. Build the image found in [`/src/disk-images/github-runner-linux`], or
   download the image built via GitHub Actions.
1. Build [`/src/go/github-runner-monitor`], or download the executable built via
   GitHub Actions.
1. Generate a GitHub access token (classic coarse-grained) with `repo`
   privileges.
1. On the runner host, execute the monitor:
   ```
   /usr/bin/env GITHUB_AUTH_TOKEN=ghp_000000000000000000 ./github-runner-monitor
   ```
   Use `./github-runner-monitor --help` to see options available, such as the
   number of CPUs / amount of RAM to allocate per runner, or the number of
   runners to maintain at a time.
1. Alternatively, set up a systemd unit or similar, possibly based on:
   ```ini
   [Unit]
   Description=GitHub Runner Monitor
   After=network.target

   [Service]
   Type=simple
   TimeoutStopSec=5min
   Environment="GITHUB_AUTH_TOKEN=ghp_000000000000000000"
   ExecStart=/usr/local/bin/github-runner-monitor

   [Install]
   WantedBy=multi-user.target
   ```

[`/src/disk-images/github-runner-linux`]: /src/disk-images/github-runner-linux
[`/src/go/github-runner-monitor`]: /src/go/github-runner-monitor
