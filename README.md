# Rancher Desktop

Rancher Desktop is an open-source project to bring Kubernetes and container management to the desktop.
Windows, macOS and Linux versions of Rancher Desktop are available for download, though do note that 
the Linux version is considered a tech preview.

## Features

Rancher Desktop provides the following features in the form of a desktop application:

- The version of Kubernetes you choose
- Ability to test upgrading Kubernetes to a new version and see how your workloads respond
- Run containers, and build, push, and pull images (powered by [nerdctl])
- Expose an application in Kubernetes for local access

All of this is wrapped in an open-source application.

[nerdctl]: https://github.com/containerd/nerdctl

## Get The App

You can download the application for macOS, Windows and Linux on the [releases page].

[releases page]: https://github.com/rancher-sandbox/rancher-desktop/releases

Running on Windows requires [Windows Subsystem for Linux (WSL2)]. This will be
installed automatically during Rancher Desktop installation.

[Windows Subsystem for Linux (WSL2)]:
https://docs.microsoft.com/en-us/windows/wsl/install-win10

Note, [development builds] are available from the CI system. Development builds
are not signed.

[development builds]:
https://github.com/rancher-sandbox/rancher-desktop/actions/workflows/package.yaml?query=branch%3Amain

For Linux, you will find both .DEB and .RPM packages attached as an asset for the most recent version.


## System Requirements
Recommended
| **OS** | **Memory** | **CPU** |
| :--- | :---: | :---: |
| macOS | 8GB | 4CPU |
| Windows | 8GB | 4CPU |
| Linux | 8GB | 4CPU |

OS versions we're currently using for development/testing:
| **OS** | **Version**
| :--- | :---: |
| macOS | Catalina 10.15 or higher |
| Windows | Home build 1909  or higher |
| Ubuntu | Ubuntu 20.04 or higher |
| openSUSE | Leap 15.3 or higher |
| Fedora | Fedora 33 or higher |

**Note:**
Feel free to use a different OS version that haven't been listed.
We are currently developing/testing Rancher Desktop on the listed OS and you can use it as a reference.

## Base Design Details

Rancher Desktop is an Electron application with the primary business logic
written in TypeScript and JavaScript.  It leverages several other pieces of
technology to provide the platform elements which include k3s, kubectl, nerdctl
WSL, qemu, and more. The application wraps numerous pieces of technology to
provide one cohesive application.

## Building The Source

Rancher can be built from source on macOS, Windows or Linux.  Cross-compilation is
currently not supported.  The following provides some detail on building.

### Prerequisites

Rancher Desktop is an [Electron] and [Node.js] application. Node.js v16 is 
recommended to build the source.  On Windows, [Go] is also required. On Linux,
[QEMU] is required at runtime.

[Electron]: https://www.electronjs.org/
[Node.js]: https://nodejs.org/
[Go]: https://golang.org/
[QEMU]: https://www.qemu.org/

#### Windows

There are two options for building from source on Windows: with a
[Development VM Setup](#development-vm-setup) or
[Manual Development Environment Setup](#manual-development-environment-setup)
with an existing Windows installation.
##### Development VM Setup

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

##### Manual Development Environment Setup

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
