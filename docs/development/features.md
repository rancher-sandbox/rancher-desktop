# Rancher Desktop Features

This document lists the high level Rancher Desktop features and their current status.

| Symbol | Description |
| ------------- | ---------------- |
| :heavy_check_mark: | released |
| :calendar: | targeted for the [next] or the [later] milestone release |
| :sun_with_face:| not planned yet, but considering for a future release |

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

:sun_with_face: Linux arm64

:sun_with_face: Windows on arm

:sun_with_face: Windows Containers

### Container runtimes

:heavy_check_mark:  Multiple CR support (containerd, dockerd)

### Docker

:heavy_check_mark: CLI

:heavy_check_mark: Swarm

:calendar: Compose

:sun_with_face: Docker-only

### Kubernetes

:heavy_check_mark: K3s bundled

:heavy_check_mark: Multiple versions support

### Bundled Tooling

:heavy_check_mark: Helm

:sun_with_face: Kubectx

:sun_with_face: [kwctl]

[kwctl]: https://github.com/kubewarden/kwctl

### Images Management

:heavy_check_mark: Build, Push, Pull & Scan images

:calendar: Repositories management

### Networking

:heavy_check_mark: Simple VPN

:calendar: Restricted VPN (Ex: Cisco AnyConnect)

### Host GPU, USBs access

:sun_with_face: GPU

:sun_with_face: USB

### Performance & System resources

:heavy_check_mark: System resource allocation

:sun_with_face: Pause app to save power  

### Security

:heavy_check_mark: Signed builds

:sun_with_face: SLSA Level

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

:sun_with_face: Container Inspection

:sun_with_face: Configuration settings

:sun_with_face: Start/Stop/Pause Containers

:sun_with_face: Silent (No-GUI) Install

:sun_with_face: CLI/Headless mode

### IDE compatibility

:heavy_check_mark: VS Code extension (Remote Containers)

:sun_with_face: Visual Studio IDE (Needs Validation)

:sun_with_face: Eclipse (Needs Validation)

### Other Rancher projects integration

:heavy_check_mark: k3s

:calendar: Rancher Dashboard

:sun_with_face: Epinio

:sun_with_face: NeuVector

:sun_with_face: Marketplace

:sun_with_face: Kubewarden

### Development

:heavy_check_mark: Open source

:heavy_check_mark: Public roadmap
