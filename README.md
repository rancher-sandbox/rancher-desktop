# Force a change - see what happens with CI.
# Rancher Desktop

Rancher Desktop is an open-source project that brings Kubernetes and
container management to the desktop. It runs on Windows, macOS and
Linux. This README pertains to the development of Rancher Desktop.
For user-oriented information about Rancher Desktop, please see [rancherdesktop.io][home].
For user-oriented documentation, please see [docs.rancherdesktop.io][docs].

[home]: https://rancherdesktop.io
[docs]: https://docs.rancherdesktop.io


## Overview

Rancher Desktop is an Electron application with the primary business logic
written in TypeScript and JavaScript.  It leverages several other pieces of
technology to provide the platform elements which include k3s, kubectl, nerdctl
WSL, QEMU, and more. The application wraps numerous pieces of technology to
provide one cohesive application.


## Setup

### Windows

There are two options for building from source on Windows: with a
[Development VM Setup](#development-vm-setup) or
[Manual Development Environment Setup](#manual-development-environment-setup)
with an existing Windows installation.


#### Development VM Setup

1. Download a Microsoft Windows 10 [development virtual machine].
   All of the following steps should be done in that virtual machine.
2. Open a PowerShell prompt (hit Windows Key + `X` and open
   `Windows PowerShell`).
3. Run the [automated setup script]:

   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   iwr -useb 'https://github.com/rancher-sandbox/rancher-desktop/raw/main/scripts/windows-setup.ps1' | iex
   ```

4. Close the privileged PowerShell prompt.
5. Ensure `msbuild_path` and `msvs_version` are configured correctly in `.npmrc` file. Run the following commands to set these properties:
   
   ```
   npm config set msvs_version <visual-studio-version-number>
   npm config set msbuild_path <path/to/MSBuild.exe>
   ```

   For example for Visual Studio 2022:

   ```
   npm config set msvs_version 2022
   npm config set msbuild_path "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"
   ```

You can now clone the repository and run `npm install`.

[development virtual machine]: https://developer.microsoft.com/en-us/windows/downloads/virtual-machines/
[automated setup script]: ./scripts/windows-setup.ps1


#### Manual Development Environment Setup

1. Install [Windows Subsystem for Linux (WSL)] on your machine. Skip this step, if WSL is already installed.
2. Open a PowerShell prompt (hit Windows Key + `X` and open `Windows PowerShell`).
3. Install [Scoop] via `iwr -useb get.scoop.sh | iex`.
4. Install git, go, nvm, and unzip via `scoop install git go nvm python unzip`.
   Check node version with `nvm list`. If node v16 is not installed or set as the current version, then install using `nvm install 16` and set as current using `nvm use 16.xx.xx`.
5. Install Visual Studio 2017 or higher. Make sure you have the `Windows SDK` component installed. This [Visual Studio docs] describes steps to install components.
   The [Desktop development with C++] workload needs to be selected, too.
6. Ensure `msbuild_path` and `msvs_version` are configured correctly in `.npmrc` file. Run the following commands to set these properties:

   ```
   npm config set msvs_version <visual-studio-version-number>
   npm config set msbuild_path <path/to/MSBuild.exe>
   ```

   For example for Visual Studio 2022:

   ```
   npm config set msvs_version 2022
   npm config set msbuild_path "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"
   ```

You can now clone the repository and run `npm install`.

[Scoop]: https://scoop.sh/
[Visual Studio docs]: https://docs.microsoft.com/en-us/visualstudio/install/modify-visual-studio?view=vs-2022
[Windows Subsystem for Linux (WSL)]: https://docs.microsoft.com/en-us/windows/wsl/install
[Desktop development with C++]: https://learn.microsoft.com/en-us/visualstudio/install/modify-visual-studio?view=vs-2022#change-workloads-or-individual-components

### macOS

Install `nvm` to get Node.js and npm:

See https://github.com/nvm-sh/nvm#installing-and-updating and run the `curl` or `wget`
command to install nvm.

Note that this script adds code dealing with `nvm` to a profile file
(like `~/.bash_profile`). To add access to `nvm` to a current shell session,
you'll need to `source` that file.

Currently we build Rancher Desktop with Node 16. To install it, run:

```
nvm install 16
```

You'll also need to run `brew install go` if you haven't installed go.

Then you can install dependencies with:
```
npm install
```

### Linux

Ensure you have the following installed:

- [Node.js][Node.js] v16. **Make sure you have any development packages
  installed.** For example, on openSUSE Leap 15.3 you would need to install
  `nodejs16` and `nodejs16-devel`.

- Go 1.18 or later.

- Dependencies described in the [`node-gyp` docs][node-gyp] installation.
  This is required to install the [`ffi-napi`][ffi-napi] npm package. These docs mention
  "a proper C/C++ compiler toolchain". You can install `gcc` and `g++` for this.

Then you can install dependencies with:

```
npm install
```

You can then run Rancher Desktop as described below. It may fail on the first run -
if this happens, try doing a factory reset and re-running, which has been known
to solve this issue.

[Node.js]: https://nodejs.org/
[ffi-napi]: https://www.npmjs.com/package/ffi-napi
[node-gyp]: https://github.com/nodejs/node-gyp#on-unix


## Running

Once you have your dependencies installed you can run a development version
of Rancher Desktop with:

```
npm run dev
```


## Tests

To run the unit tests:

```
npm test
```

To run the integration tests:

```
npm run test:e2e
```


## Building

Rancher can be built from source on Windows, macOS or Linux.
Cross-compilation is currently not supported. To run a build do:

```
npm run build
```

The build output goes to `dist/`.


## Development Builds

### Windows and macOS

Each commit triggers a GitHub Actions run that results in application bundles
(`.exe`s and `.dmg`s) being uploaded as artifacts. This can be useful if you
want to test the latest build of Rancher Desktop as built by the build system.
You can download these artifacts from the Summary page of completed `package`
actions.


### Linux

Similar to Windows and macOS, Linux builds of Rancher Desktop are made from each
commit. However on Linux, only part of the process is done by GitHub Actions.
The final part of it is done by [Open Build Service][OBS].

There are two channels of the Rancher Desktop repositories: `dev` and `stable`.
`stable` is the channel that most users use. It is the one that users are
instructed to add in the official [documentation][docs], and the one that contains
builds that are created from official releases. `dev` is the channel that we are
interested in here: it contains builds created from the latest commit made on
the `main` branch, and on any branches that match the format `release-*`. To
learn how to install the development repositories, see below.

When using the `dev` repositories, it is important to understand the format of
the versions of Rancher Desktop available from the `dev` repositories.
The versions are in the format:

```
<priority>.<branch>.<commit_time>.<commit>
```

where:

`priority` is a meaningless number that exists to give versions built from the `main`
branch priority over versions built from the `release-*` branches when updating.

`branch` is the branch name; dashes are removed due to constraints imposed by
package formats.

`commit_time` is the UNIX timestamp of the commit used to make the build.

`commit` is the shortened hash of the commit used to make the build.

[docs]: https://docs.rancherdesktop.io
[OBS]: https://build.opensuse.org/


#### `.deb` Development Repository

You can add the repo with the following steps:

```
curl -s https://download.opensuse.org/repositories/isv:/Rancher:/dev/deb/Release.key | gpg --dearmor | sudo dd status=none of=/usr/share/keyrings/isv-rancher-dev-archive-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/isv-rancher-dev-archive-keyring.gpg] https://download.opensuse.org/repositories/isv:/Rancher:/dev/deb/ ./' | sudo dd status=none of=/etc/apt/sources.list.d/isv-rancher-dev.list
sudo apt update
```

You can see available versions with:

```
apt list -a rancher-desktop
```

Once you find the version you want to install you can install it with:

```
sudo apt install rancher-desktop=<version>
```

This works even if you already have a version of Rancher Desktop installed.


#### `.rpm` Development Repository

You can add the repo with:

```
sudo zypper addrepo https://download.opensuse.org/repositories/isv:/Rancher:/dev/rpm/isv:Rancher:dev.repo
sudo zypper refresh
```

You can see available versions with:

```
zypper search -s rancher-desktop
```

Finally, install the version you want with:

```
zypper install --oldpackage rancher-desktop=<version>
```

This works even if you already have a version of Rancher Desktop installed.


#### Development AppImages

There are no repositories for AppImages, but you can access the latest development
AppImage builds [here](https://download.opensuse.org/repositories/isv:/Rancher:/dev/AppImage/).


## Contributing

Please see [the document about contributing](CONTRIBUTING.md).


## Further Reading

Please see the [docs](docs/development/) directory for further developer documentation.
