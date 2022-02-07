# Rancher Desktop

Rancher Desktop is an open-source project that brings Kubernetes and
container management to the desktop. It runs on Windows, macOS and
Linux. The below documentation pertains to the development of Rancher
Desktop. For information not related to the development of Rancher
Desktop, please see [rancherdesktop.io][home]. For documentation,
please see [docs.rancherdesktop.io][docs].

[home]: https://rancherdesktop.io
[docs]: https://docs.rancherdesktop.io


## Installing

In order to work with Rancher Desktop, you need a few things:

- [Node.js][Node.js] v16
- [Go][Go] 1.16 or later (required only for Windows)

Once you have these things, you need to install Rancher Desktop's
dependencies:

```
npm run install
```

This step should be repeated after every pull of new code, since
dependencies change frequently.

[Node.js]: https://nodejs.org/
[Go]: https://go.dev/


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
Cross-compilation is currently not supported.


### Windows

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


### macOS

Simply run:

```
npm run build
```


### Linux

On Linux it is not possible to completely build Rancher Desktop from
the development environment. This is because [Open Build Service][OBS]
is used to build the application package into a variety of Linux
package formats.

[OBS]: https://build.opensuse.org/
