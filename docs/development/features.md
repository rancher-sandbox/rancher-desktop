# Rancher Desktop Features

This document lists the high level Rancher Desktop features and their current status.

| Symbol | Description |
| ------------- | ---------------- |
| :heavy_check_mark: | released |
| :calendar: | targeted for the [next] or the [later] milestone release |
| :no_entry:| not planned yet, but considering for a future release |

Note:
- Items under [next] milestone are targeted for the upcoming monthly release, which usually happens on the 4th wednesday of the month.
- Items under the [later] milestone and any spill over items from the [next] milestone are targeted for the release after.
- Items under [next] and [later] milestones might change based on the user feedback, technical challenges etc.

[next]: https://github.com/rancher-sandbox/rancher-desktop/projects/1?card_filter_query=milestone%3Anext
[later]: https://github.com/rancher-sandbox/rancher-desktop/projects/1?card_filter_query=milestone%3Alater

### OS & Platform support
:heavy_check_mark: Win 10/11

:heavy_check_mark: Mac (Intel)

:heavy_check_mark: Mac M1 (apple silicon)

:heavy_check_mark: Linux

:no_entry: Linux arm64

### Container runtimes
:heavy_check_mark:  Multiple CR support (containerd, dockerd)

### Docker
:heavy_check_mark: CLI

:heavy_check_mark: Swarm

:calendar: Compose

:no_entry: Docker-only

### Kubernetes
:heavy_check_mark: K3s bundled

:heavy_check_mark: Multiple versions support

### Bundled Tooling
:heavy_check_mark: Helm

:no_entry: Kubectx

### Images Management
:heavy_check_mark: Build, Push, Pull & Scan images

:calendar: Repositories management

### Networking
:calendar:Simple VPN

:calendar: Restricted VPN (Ex: Cisco AnyConnect)

### Host GPU, USBs access
:no_entry: GPU

:no_entry: USB

### Performance & System resources
:heavy_check_mark: System resource allocation

:no_entry: Pause app to save power  

### Security
:heavy_check_mark: Signed builds

:no_entry: SLSA Level

### Troubleshooting
:heavy_check_mark: View logs

:heavy_check_mark: Partial Reset

:heavy_check_mark: Factory Reset

### GUI
:heavy_check_mark: View Containers

:heavy_check_mark: View Images

:heavy_check_mark: Port forwarding

:heavy_check_mark: Auto updates

:calendar: Cluster exploration - Rancher Dashboard

:no_entry: Container Inspection

:no_entry: Configuration settings

:no_entry: Start/Stop/Pause Containers

### IDE compatibility
:calendar: VS Code extensions (Remote Containers, Docker, Docker compose etc)

:no_entry: Visual Studio IDE

:no_entry: Eclipse

### Other Rancher projects integration
:heavy_check_mark: k3s

:calendar: Rancher Dashboard

:no_entry: Epinio

:no_entry: NueVector

:no_entry: Kubewarden

:no_entry: Marketplace

### Development
:heavy_check_mark: Open source

:heavy_check_mark: Public roadmap
