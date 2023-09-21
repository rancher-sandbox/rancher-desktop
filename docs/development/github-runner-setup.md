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

The runner configuration we have tested is:

- Ubuntu 22.04
- 32GB memory

### Configuration

- `sudo apt install liblttng-ust1 make g++ xvfb curl docker.io`
- `sudo useradd --groups docker,kvm --create-home runner`
- `sudo mkdir /runner`
- `sudo chown runner:runner /runner`
- Download the runner code per GitHub instructions (currently 2.309.0); the
  instructions show up when going through adding a runner in the repoistory
  settings.
- Configure the runner (also in GitHub instructions):

  `./config.sh --url https://github.com/rancher-sandbox/rancher-desktop
   --token …`
- Register the runner as a service:

  `sudo ./svc.sh install runner`
- Run the service under X11:

  Create `/etc/systemd/system/actions.runner.….service.d/run-in-xvfb.conf` with
  contents:
  ```ini
  [Service]
  ExecStart=
  ExecStart=/usr/bin/xvfb-run -a /runner/runsvc.sh
  ```
- Start the service:
  `sudo systemctl enable --now actions.runner.….service`
