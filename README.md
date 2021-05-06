# Rancher Desktop

Rancher Desktop is an open-source project to bring Kubernetes and container management to the desktop.
Windows and MacOS versions of Rancher Desktop are available for download.

## Features

Rancher Desktop provides the following features in the form of a desktop application:

- The version of Kubernetes you choose
- Ability to test upgrading Kubernetes to a new version and see how your workloads respond
- Build, push, and pull images (powered by [KIM](https://github.com/rancher/kim))
- Expose an application in Kubernetes for local access

All of this is wrapped in an open-source application.

## Get The App

You can download the application for MacOS and Windows on the [releases page](https://github.com/rancher-sandbox/rd/releases).

Running on Windows requires [Windows Subsystem for Linux (WSL)](https://docs.microsoft.com/en-us/windows/wsl/install-win10).
Please install WSL prior to installing Rancher Desktop. In a future release
Rancher Desktop will automate the step for you.

Note, [development builds](https://github.com/rancher-sandbox/rd/actions/workflows/package.yaml) are available from the CI system. Development builds are not signed.

## Base Design Details

Rancher Desktop is an electron application with the primary business logic being written in TypeScript and JavaScript. It leverages several other pieces of technology to provide the platform elements which include k3s, kim, kubectl, wsl, hyperkit, and more. The application wraps numerous pieces of technology to provide one cohesive application.

## Building The Source

Rancher can be built from source on MacOS or Windows. The following provides some detail on building.

### Prerequisites

Rancher Desktop is an [electron](https://www.electronjs.org/) and [node.js](https://nodejs.org/) application. node.js needs to be installed to build the source.

The following is a breakdown of the pre-requisites for each platform. These need to be installed first.

**macos:**

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

**ubuntu:**

```bash
sudo apt-get install -y libcairo2-dev libpango1.0-dev libpng-dev libjpeg-dev libgif-dev librsvg2-dev
```

### Windows

1. Download a Microsoft Windows 10 [development virtual machine].
2. Open a privileged PowerShell prompt (hit Windows Key + `X` and open
   `Windows PowerShell (Admin)`).
3. Run the [automated setup script]:
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

   iwr -useb 'https://github.com/rancher-sandbox/rd/raw/main/scripts/windows-setup.ps1' | iex
   ```
4. Close the privileged PowerShell prompt.

You are now ready to clone the repository and run `npm install`.

[development virtual machine]: https://developer.microsoft.com/en-us/windows/downloads/virtual-machines/
[automated setup script]: ./scripts/windows-setup.ps1

#### Manual Development Environment Setup

1. Download and install [Visual Studio], taking care to install:
   - MSVC v141 - VS 2017 C++ x64/x86 build tools (v14.16)
   - MSVC v142 - VS 2019 C++ x64/x86 build tools (Latest)
2. Download the [GTK+ Win64 bundle]; it is recommended to install it in the
   default location at `C:\GTK`.
3. Download the [libjpeg-turbo development files]; it is recommended to install
   it in the default location at `C:\libjpeg-turbo64`.
4. Install git, Python 2.x, and NodeJS.
   1. Install [Scoop] via `iwr -useb get.scoop.sh | iex`
   2. Install git and nvm via `scoop install git nvm`
   3. Add the old versions bucket via `scoop bucket add versions`
   4. Install nvm and Python 2 via `scoop install python27`
   5. Install NodeJS via `nvm install latest`
      * Remember to use it by running `nvm use $(nvm list)`
5. Configure NPM to use the version of MSBuild installed:
   ```powershell
   npm config set msbuild_path "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe"
   ```
   Note that this is the default path; the path on your system may differ.

If you have customized the GTK and libjpeg paths, you will need to run
`npm install` with the `GYP_DEFINES` variable set to point to them.  In
PowerShell, this would look something like:

```powershell
$Env:GYP_DEFINES = 'GTK_Root="C:/Path/To/GTK" jpeg_root="C:/Path/To/libjpeg"'
```

[Visual Studio]: https://visualstudio.microsoft.com/
[GTK+ Win64 bundle]: https://download.gnome.org/binaries/win64/gtk+/2.22/
[libjpeg-turbo development files]: https://sourceforge.net/projects/libjpeg-turbo/files/2.0.6/libjpeg-turbo-2.0.6-vc64.exe/download
[Scoop]: https://scoop.sh/

### How To Run

Use the following commands. The former is needed the first time or after an
update is pulled from upstream. The latter is needed for follow-up starts.

```
npm install
npm run dev
```
