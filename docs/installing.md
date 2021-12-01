# Installing Rancher Desktop

Rancher Desktop is delivered as a desktop application. You can download it from
the [releases page on GitHub](https://github.com/rancher-sandbox/rancher-desktop/releases).

When run for the first time or when changing versions, Kubernetes container
images are downloaded. It may take a little time to load on first run for a new
Kubernetes version.

## macOS

### Requirements

Rancher Desktop requires the following on macOS:

- macOS Catalina 10.15 or higher.
- Intel CPU with VT-x.
- Persistent internet connection.

Apple Silicon (M1) support is planned, but not currently implemented.

It is also recommended to have:

- 8 GB of memory
- 4 CPU

Additional resources may be required depending on the workloads you plan to run.

### Installing Rancher Desktop on macOS

1. Go to the [releases page] on GitHub.
1. Find the version of Rancher Desktop you want to download.
1. Expand the **Assets** section and download `Rancher.Desktop-X.Y.Z.dmg`, where `X.Y.Z` is the version of Rancher Desktop.
1. Navigate to the directory where you downloaded the installer to and run the installer. This will usually be the `Downloads` folder.
1. Double-click the DMG file.
1. In the Finder window that opens, drag the Rancher Desktop icon to the Applications folder.
1. Navigate to the `Applications` folder and double-click the Rancher Desktop to launch it.

[releases page]:
https://github.com/rancher-sandbox/rancher-desktop/releases

After Rancher Desktop is installed, users will have access to these supporting utilities:

- [Helm](https://helm.sh/)
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/)
- [nerdctl](https://github.com/containerd/nerdctl)
- [Kubernetes Image Manager (kim)](https://github.com/rancher/kim)

### Uninstalling Rancher Desktop on macOS

1. Open **Finder** > **Applications**.
1. Find Rancher Desktop.
1. Select it and choose **File > Move to Trash**.
1. To delete the app, Finder > Empty Trash.

## Windows

### Requirements

Rancher Desktop requires the following on Windows:

- Windows 10 build 1909 or higher. The Home edition is supported.
- Running on a machine with [virtualization capabilities].
- Persistent internet connection.

Rancher Desktop requires [Windows Subsystem for Linux] on Windows; this will
automatically be installed as part of the Rancher Desktop setup.  Manually
downloading a distribution is not necessary.

[Windows Subsystem for Linux]:
https://docs.microsoft.com/en-us/windows/wsl/install-win10

[virtualization capabilities]:
https://docs.microsoft.com/en-us/windows/wsl/troubleshooting#error-0x80370102-the-virtual-machine-could-not-be-started-because-a-required-feature-is-not-installed

It is also recommended to have:

- 8 GB of memory
- 4 CPU

Additional resources may be required depending on the workloads you plan to run.

### Installing Rancher Desktop on Windows

1. Go to the [releases page] on GitHub.
1. Find the version of Rancher Desktop you want to download.
1. Expand the **Assets** section and download the Windows installer. It will be called `Rancher.Desktop.Setup.X.Y.Z.exe`, where `X.Y.Z` is the version of Rancher Desktop.
1. Navigate to the directory where you downloaded the installer to and run the installer. This will usually be the `Downloads` folder.
1. Review the License Agreement and click **I Agree** to proceed with the installation.
1. When the installation completes, click **Finish** to close the installation wizard.

[release page]:
https://github.com/rancher-sandbox/rancher-desktop/releases

After Rancher Desktop is installed, users will have access to these supporting utilities:

- [Helm](https://helm.sh/)
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/)
- [nerdctl](https://github.com/containerd/nerdctl)
- [Kubernetes Image Manager (kim)](https://github.com/rancher/kim)

### Uninstalling Rancher Desktop on Windows

1. From the taskbar, click the **Start** menu.
1. Go to **Settings > Apps > Apps & features**.
1. Find and select the Rancher Desktop entry.
1. Click **Uninstall** and click it again when the confirmation appears.
1. Follow the prompts on the Rancher Desktop uninstaller to proceed.
1. Click **Finish** when complete.

## Linux

### Requirements

Rancher Desktop requires the following on Linux:

- A distribution that can install .deb or .rpm packages, or AppImages.
- A persistent internet connection.

It is also recommended to have:

- 8 GB of memory
- 4 CPU

Additional resources may be required depending on the workloads you plan to run.

### Installation via .deb Package

Add the Rancher Desktop repository and install Rancher Desktop with:

```
curl https://download.opensuse.org/repositories/isv:/Rancher:/stable/deb/Release.key | sudo apt-key add -
echo 'deb https://download.opensuse.org/repositories/isv:/Rancher:/stable/deb/ ./' | sudo tee --append /etc/apt/sources.list
sudo apt update
sudo apt install rancher-desktop
```

### Uninstalling .deb Package

### Installing via .rpm Package

Note: RHEL, Fedora and related distributions package QEMU, which Rancher Desktop
uses on Linux, differently than other distributions. To use Rancher Desktop on these
distributions, please use the AppImage.

### Uninstalling .rpm Package

### Installing via AppImage

### Uninstalling AppImage
