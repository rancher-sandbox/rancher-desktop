# Rancher Desktop

Rancher Desktop is an open-source project that brings Kubernetes and
container management to the desktop. It runs on Windows, macOS and
Linux. For information not related to the development of Rancher
Desktop, please see [rancherdesktop.io][home]. For documentation,
please see [docs.rancherdesktop.io][docs].

[home]: https://rancherdesktop.io
[docs]: https://docs.rancherdesktop.io


## Building The Source

Rancher can be built from source on macOS, Windows or Linux.  Cross-compilation is
currently not supported.  The following provides some detail on building.


### Building on Windows

There are two options for building from source on Windows: with a
[Development VM Setup](#development-vm-setup) or
[Manual Development Environment Setup](#manual-development-environment-setup)
with an existing Windows installation.

#### Development VM Setup

1. Download a Microsoft Windows 10 [development virtual machine].
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

You are now ready to clone the repository and run `npm install`.

[development virtual machine]: https://developer.microsoft.com/en-us/windows/downloads/virtual-machines/
[automated setup script]: ./scripts/windows-setup.ps1


#### Manual Development Environment Setup

1. Install [Windows Subsystem for Linux (WSL)] on your machine. Skip this step, if WSL is already installed.
2. Open a PowerShell prompt (hit Windows Key + `X` and open `Windows PowerShell`).
3. Install [Scoop] via `iwr -useb get.scoop.sh | iex`.
4. Install git, go, nvm, and unzip via `scoop install git go nvm python unzip`.
   Check node version with `nvm list`. If node v16 is not installed or set as the current version, then install using `nvm install 16` and set as current using `nvm use 16.xx.xx`.
5. Install Visual Studio 2017 or higher. Make sure you have the `Windows SDK` component installed. This [Visual Studio docs] describes steps to install components.
6. Ensure `msbuild_path` and `msvs_version` are configured correctly in `.npmrc` file. Run the following commands to set these properties:

  ```
  npm config set msvs_version <visual-studio-version-number>
  npm config set msbuild_path <path/to/MSBuild.exe>
  ```

[Scoop]: https://scoop.sh/
[Visual Studio docs]: https://docs.microsoft.com/en-us/visualstudio/install/modify-visual-studio?view=vs-2022
[Windows Subsystem for Linux (WSL)]: https://docs.microsoft.com/en-us/windows/wsl/install


### Prerequisites

Rancher Desktop is an [Electron] and [Node.js] application. Node.js v16 is 
recommended to build the source.  On Windows, [Go] is also required.

[Electron]: https://www.electronjs.org/
[Node.js]: https://nodejs.org/
[Go]: https://golang.org/


### How To Run

Use the following commands. The former is needed the first time or after an
update is pulled from upstream. The latter is needed for follow-up starts.

```
npm install
npm run dev
```

To build the distributable (application bundle on macOS, installer on Windows),
run `npm run build`.

On Linux `npm run build` produces a zip file including the built binaries. To build the 
distributable artifacts (RPM, Deb or AppImage) the [Open Build Service] is used.
OBS makes use of the packaging recipes under `packaging/linux` folder of this
repository together with the zip file including all built binaries.

[Open Build Service]: https://build.opensuse.org/

### How To Test

Use the following commands to run unit tests and e2e tests.

```
npm test
npm run test:e2e
```
