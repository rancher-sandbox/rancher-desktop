# Installing Rancher Desktop

Rancher Desktop is delivered as a desktop application. You can download it from
the [releases page on GitHub](https://github.com/rancher-sandbox/rancher-desktop/releases).

When run for the first time or when changing versions, Kubernetes container
images are downloaded. It may take a little time to load on first run for a new
Kubernetes version.

## macOS

Rancher Desktop requires the following on macOS:

- macOS 10.10 or higher.
- Intel CPU with VT-x.
- Persistent internet connection.

Apple Silicon (M1) support is planned, but not currently implemented.

## Windows

Rancher Desktop requires the following on Windows:

- Windows 10, at least version 1903.
- Running on a machine with [virtualization capabilities].
- Persistent internet connection.

Rancher Desktop requires [Windows Subsystem for Linux] on Windows; this will
automatically be installed as part of the Rancher Desktop setup.  Manually
downloading a distribution is not necessary.

[Windows Subsystem for Linux]:
https://docs.microsoft.com/en-us/windows/wsl/install-win10

[virtualization capabilities]:
https://docs.microsoft.com/en-us/windows/wsl/troubleshooting#error-0x80370102-the-virtual-machine-could-not-be-started-because-a-required-feature-is-not-installed

## Linux

Rancher Desktop v0.6.0 includes a Technical Preview of Linux support. rpm, deb, and archive files are available for download.
