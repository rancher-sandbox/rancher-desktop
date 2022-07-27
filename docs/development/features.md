# Rancher Desktop Features

This document lists the high-level Rancher Desktop features and their current status.

| Symbol | Description |
| ------------- | ---------------- |
| :heavy_check_mark: | released |
| :calendar: | targeted for the [next] or the [later] milestone release |
| :sun_with_face:| not planned yet, but considering for a future release |

Note:
- Items under the [next] milestone are targeted for the upcoming monthly release, which usually happens on the 4th Wednesday of the month.
- Items under the [later] milestone and any spillover items from the [next] milestone are targeted for the release after.
- Items under the [next] and [later] milestones might change based on user feedback, technical challenges, etc.

[next]: https://github.com/rancher-sandbox/rancher-desktop/projects/1?card_filter_query=milestone%3Anext
[later]: https://github.com/rancher-sandbox/rancher-desktop/projects/1?card_filter_query=milestone%3Alater

### OS & Platform Support

:heavy_check_mark: Win 10/11

:heavy_check_mark: Mac (Intel)

:heavy_check_mark: Mac M1 (apple silicon)

:heavy_check_mark: Linux

:sun_with_face: Linux AArch64

:sun_with_face: Windows on AArch64

:sun_with_face: Windows Containers

### Container Engines

:heavy_check_mark:  Multiple CR support (containerd, dockerd)

### Docker

:heavy_check_mark: CLI

:heavy_check_mark: Swarm

:heavy_check_mark: Compose

:heavy_check_mark: Docker-only

### Kubernetes

:heavy_check_mark: K3s bundled

:heavy_check_mark: Multiple versions support

### Bundled Tooling

:heavy_check_mark: Helm

:sun_with_face: Kubectx

:sun_with_face: [kwctl]

[kwctl]: https://github.com/kubewarden/kwctl

### Image Management

:heavy_check_mark: Build, Push, Pull & Scan images

:calendar: Registry Configuration

:sun_with_face: Registry Access Control

### Networking

:heavy_check_mark: Simple VPN

:calendar: Restricted VPN (Ex: Cisco AnyConnect)

### Host Access

:sun_with_face: GPU

:sun_with_face: USB

### Performance & System Resources

:heavy_check_mark: System resource allocation

:sun_with_face: Pause app to save power  

### Security

:heavy_check_mark: Signed builds

:sun_with_face: SBOM generation for images

:sun_with_face: Image Signing

:sun_with_face: Attain SLSA Level

### Troubleshooting

:heavy_check_mark: View logs

:heavy_check_mark: Partial Reset

:heavy_check_mark: Factory Reset

### GUI/Installation

:heavy_check_mark: View Containers

:heavy_check_mark: View Images

:heavy_check_mark: Port forwarding

:heavy_check_mark: Auto updates

:heavy_check_mark: Cluster exploration - Rancher Dashboard (Preview)

:sun_with_face: Container Exploration

:sun_with_face: Configuration settings

:sun_with_face: Start/Stop/Pause Containers

:sun_with_face: Silent (No-GUI) Install

:sun_with_face: CLI/Headless mode

:calendar: Offline (air gap) mode

:heavy_check_mark: Rancher Desktop CLI aka rdctl (Preview)

### IDE Compatibility

:heavy_check_mark: VS Code extension (With dockerd(moby))

:sun_with_face: Visual Studio IDE (Needs Validation)

:sun_with_face: Eclipse (Needs Validation)

### Integration with Other Rancher Projects

:heavy_check_mark: k3s

:calendar: Rancher Dashboard

:sun_with_face: Epinio

:sun_with_face: NeuVector

:sun_with_face: Marketplace

:sun_with_face: Kubewarden

### Development

:heavy_check_mark: Open source

:heavy_check_mark: Public roadmap
