## Overview

BATS is a testing framework for Bash shell scripts that provides supporting libraries and helpers for customizable test automation.

## Setup

It's important to have a Rancher Desktop CI or release build installed and running with no errors before executing the BATS tests.

### On Windows:

Clone the Git repository of Rancher Desktop, whether directly inside a WSl distro or on the host Win32.
If the repository will be cloned on Win32, prior to cloning it, it's important to set up the Git configuration by running the following commands:

  ```powershell
  git config --global core.eol lf
  git config --global core.autocrlf false
  ```
Note that changing `crlf` settings is not needed when you clone it inside a WSL distro.
Regardless of the repository location, the BATS tests can be executed ONLY from inside a WSL distribution. So, if the repository is cloned on Win32, the repository can be located within a WSL distro from /mnt/c, as it represents the `C:` drive on Windows.

### On Linux:

ImageMagick is required to take screenshots on failure.

### All platforms:

From the root directory of the Git repository, run the following commands to install BATS and its helper libraries into the BATS test directory:

  ```sh
  git submodule update --init
  ```

## Running BATS

To run the BATS test, specify the path to BATS executable from bats-core and run the following commands:

To run a specific test set from a bats file:

```sh
cd bats
./bats-core/bin/bats tests/registry/creds.bats
```

To run all BATS tests:

```sh
cd bats
./bats-core/bin/bats tests/*/
```

To run the BATS test, specifying some of Rancher Desktop's configuration, run the following commands:

```sh
cd bats
RD_CONTAINER_RUNTIME=moby RD_USE_IMAGE_ALLOW_LIST=false ./bats-core/bin/bats tests/registry/creds.bats
```

There is an experimental subset of BATS tests that pass with an under-construction openSUSE based
distribution; that can be selected via the `opensuse` tag:

```sh
cd bats
./bats-core/bin/bats --filter-tags opensuse tests/*/
```

### On Windows:

BATS must be executed from within a WSL distribution. (You have to cd into `/mnt/c/REPOSITORY_LOCATION` from your unix shell.)

To test the Windows-based tools, set `RD_USE_WINDOWS_EXE` to `true` before running.

### RD_LOCATION

By default bats will use Rancher Desktop installed in a "system" location. If
that doesn't exists, it will try a "user" location, followed by the local "dist"
directory inside the local git directory. The final option if none of the above
apply is to use "dev", which uses `yarn dev`. On Linux there is no "user"
location.

You can explicitly request a specific install location by setting `RD_LOCATION` to `system`, `user`, `dist`, or `dev`:

```
cd bats
RD_LOCATION=dist ./bats-core/bin/bats ...
```

### RD_NO_MODAL_DIALOGS

By default, bats tests are run with the `--no-modal-dialogs` option so fatal errors are written to `background.log`,
rather than appearing in a blocking modal dialog box. If you *want* those dialog boxes, you can specify

```
cd bats
RD_NO_MODAL_DIALOGS=false ./bats-core/bin/bats ...
```

The default value for this environment variable is `true`.

## Writing BATS Tests

1. Add BATS test by creating files with `.bats` extension under `./bats/tests/FOLDER_NAME`
2. A Bats test file is a Bash script with special syntax for defining test cases. BATS syntax and libraries for defining test hooks, writing assertions and treating output can be accessed via BATS [documentation](https://bats-core.readthedocs.io/en/stable/):
    - [bats-core](https://github.com/rancher-sandbox/bats-core)
    - [bats-assert](https://github.com/rancher-sandbox/bats-assert)
    - [bats-file](https://github.com/rancher-sandbox/bats-file)
    - [bats-support](https://github.com/rancher-sandbox/bats-support)

## BATS linting

After finishing to develop a BATS test suite, you can locally verify the syntax and formatting feedback by linting prior to submitting a PR, following the instructions:

  1. Make sure to have installed `shellcheck` and `shfmt`.

     On macOS:
     - Assuming you have Homebrew:
       ```sh
       brew install shfmt shellcheck
       ```
     - If you have Go installed, you can also install `shfmt` by running:
       ```sh
       go install mvdan.cc/sh/v3/cmd/shfmt@v3.6.0
       ```

     On Linux:
     - The simplest way to install ShellCheck locally is through your package managers
       such as `apt/apt-get/yum`. Run commands as per your distro.
       ```
       sudo apt install shellcheck
       ```
     - `shfmt` is available as a snap application. If your distribution has snap
       installed, you can install `shfmt` using the command:
       ```sh
       sudo snap install shfmt
       ```
       The other way to install `shfmt` is by using the following one-liner command:
       ```sh
       curl -sS https://webinstall.dev/shfmt | bash
       ```
       If you have Go installed, you can also install `shfmt` by running:
       ```sh
       go install mvdan.cc/sh/v3/cmd/shfmt@v3.6.0
       ```
     On Windows:
     - The simplest way to install `shellcheck` locally is:

       Via chocolatey:
       ```powershell
       choco install shellcheck
       ```
       Via scoop:
       ```powershell
       scoop install shellcheck
       ```
     - If you have Go installed, you can install `shfmt` by running:
       ```powershell
       go install mvdan.cc/sh/v3/cmd/shfmt@v3.6.0
       ```

  2. Get the syntax and formatting feedback for BATS linting by running from the
     root directory of the Git repository:
     ```sh
     make -C bats lint
     ```
  3. Please, make sure to fix the highlighted linting errors prior to submitting
     a PR. You can automatically apply formatting changes suggested by `shfmt`
     by running the following command:
     ```sh
     shfmt -w ./bats/tests/containers/factory-reset.bats
     ```

## Running BATS in CI

We also run BATS in CI via [GitHub Actions]; at the time of writing, we do not
yet run them automatically due to failing tests.  There are many optional fields
that may be set when triggering a run manually:

[GitHub Actions]: https://github.com/rancher-sandbox/rancher-desktop/actions/workflows/bats.yaml

<!-- This table is done in HTML to allow line wrapping -->
<table>
  <thead> <tr> <th>Input <th>Description
  <tbody>
  <tr><td><code>owner</code>, <code>repo</code>
    <td>Forms the GitHub repository to test; defaults to the current repository.
  <tr><td><code>branch</code>
    <td>The branch to test; defaults to the current branch.
  <tr><td><code>tests</code>
    <td>The list of tests, as a whitespace-separated glob expression relative to the
    <a href="tests"><code>tests</code></a> directory.  The <code>.bats</code>
    suffix may be omitted on test files.
  <tr><td><code>platforms</code>
    <td>A space-separated list of platforms to test on; defaults to everything,
    and items may be removed to reduce coverage.
  <tr><td><code>engines</code>
    <td>A space-separated list of container engines to test on; defaults to
    everything, and items may be removed to reduce coverage.
  <tr><td><code>package-id</code>
    <td>A specific GitHub run ID for the
    <a href="https://github.com/rancher-sandbox/rancher-desktop/actions/workflows/package.yaml">package action</a>
    to test.  This allows to test code from runs where it failed to build on
    platforms that don't need to be tested, or in-process runs as long as the
    relevant platforms have already completed.
  </tbody>
</table>

### Debugging BATS in CI

Sometimes we may need to drill down why a test is failing in CI (for example,
when the same test doesn't fail locally).  Some things might be helpful:

- Logs for failing runs can be downloaded by clicking on the :file_folder: icon
  in the summary table at the bottom of the run.
- If changes to the application or BATS tests are required, a new [package
  action] run will need to be manually triggered.  In that case, setting `sign`
  to `false` in that run will speed it up by a few minutes, by skipping the
  check for properly signed installers — that can be dealt with when the actual
  PR is made.
- When focusing on a particular failing platform, it may be possible to shave
  off a few minutes by setting the `package-id` field (see above) when starting
  the BATS run; this lets you start the run once the platform you're interested
  in has completed packaging, without waiting for other platforms.  This should
  be set to the number after `…/actions/runs/` in the URL.
- When testing, it is a good idea to [fork the repository] and run the tests
  there; this lets you have your own set of GitHub runner quota (which means not
  waiting for PRs other people create).  It is not necessary to set `owner` and
  `repo` fields when running the BATS action (because it defaults to the
  repository the action is running on).  You will, however, need to run the
  [package action] at least once in your fork.
- It is much faster to specify `tests`, `platforms`, and `engines` to limit
  runs to only the tests you care about; the full run takes somewhere over two
  hours total, even spread out over multiple parallel jobs.

[package action]: https://github.com/rancher-sandbox/rancher-desktop/actions/workflows/package.yaml
[fork the repository]: https://github.com/rancher-sandbox/rancher-desktop/fork
