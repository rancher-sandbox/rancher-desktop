# Preferences

## General

The **General** tab, provides general information about the project's status as well as links to discuss the project, report issues, or to learn more about the project.

### Check for updates automatically

When an update is available, users are provided a notification and the release notes for the upgrade target. This happens whether automatic updates are enabled or not. If this option is enabled, the update is downloaded and then installed the next time Rancher Desktop is started.

### Allow collection of anonymous statistics to help us improve Rancher Desktop

This option allows Rancher Desktop to collect information on how you interact with the Rancher Desktop application. Information such as what workloads you run are not collected.

## Kubernetes Settings

On the **Kubernetes Settings** tab, you can manage the settings of your virtual machine.

### Kubernetes Version

This option presents a list of Kubernetes versions that your Rancher Desktop instance can use. 

When upgrading:

- A check is performed to see if the target Kubernetes version is available locally. If not, it downloads the files.
- Workloads are retained.
- Images are retained.

When downgrading:

- Workloads are removed.
- Images are retained.

To switch versions:

1. Click the **Kubernetes version** drop-down menu.
1. Select the version you want to change to.
1. On the confirmation window, click **OK** to proceed.

### Memory (macOS & Linux)

The amount of memory to allocate to Rancher Desktop. The selectable range is based on your system. The red area within the range indicates an allocation that may affect system services.

This option is not available for Rancher Desktop on Windows. With WSL, memory allocation is configured globally across all Linux distributions. Refer to the [WSL documentation] for instructions.

[WSL documentation]:
https://docs.microsoft.com/en-us/windows/wsl/wsl-config#options-for-wslconfig

### CPUs (macOS & Linux)

The number of CPUs to allocate to Rancher Desktop. The selectable range is based on your system. The red area within the range indicates an allocation that may affect system services.

This option is not available for Rancher Desktop on Windows. With WSL, CPU allocation is configured globally across all Linux distributions. Refer to the [WSL documentation] for instructions.

[WSL documentation]:
https://docs.microsoft.com/en-us/windows/wsl/wsl-config#options-for-wslconfig

### Port

Set the port Kubernetes is exposed on. Use this setting to avoid port collisions if multiple instances of K3s are running.

### Reset Kubernetes/Reset Kubernetes and Container Images

This option removes all workloads and Kubernetes configurations. 
Images that have been pulled are not removed when a reset occurs.
1. On the confirmation window, click **OK** to proceed.

At this point, Kubernetes is stopped then workloads and configurations are removed. Kubernetes is then be started again.

## WSL Integration (Windows)

The **WSL Integration** tab gives the option to make the Rancher Desktop Kubernetes configuration accessible to any Linux distributions configured for WSL. Once enabled, you can use communicate with the Rancher Desktop Kubernetes cluster using tools like `kubectl` from within the WSL distribution.

## Port Forwarding (Windows)

To forward a port:

1. Find the service and click **Forward**. A random port is assigned.
1. Optional: click **Cancel** to remove the port assigned.

## Supporting Utilities (macOS & Linux)

On the **Supporting Utilities** tab, you can create symbolic links to tools in /usr/local/bin. By default, a symbolic links is created if the tool is not already linked.

Symbolic links can be created (or removed) for the following tools, which are installed as part Rancher Desktop:

- helm
- kim
- kubectl
- nerdctl
- docker

## Images

The **Images** tab, allows you to manage the images on your virtual machine.

To manage your images using nerdctl instead, refer to the [Images](./images) section.

### Scanning Images

This feature uses [Trivy] to scan your images for vulnerabilities and configuration issues.

To scan an image:

1. From the image list, find the image you want to scan.
1. Click **⋮ > Scan**.
1. Review the results then click **Close Output to Continue**.

[Trivy]:
https://github.com/aquasecurity/trivy

### Adding Images

#### Pulling Images

Use this option to pull images from a registry to your virtual machine.

To pull an image:

1. Click the **+** button in the top-right corner.
1. Click on the **Pull** tab.
1. Enter the name of the image to pull.
    > Note: By default, images are pulled from [Docker Hub] in which use the `repo/image[:tag]` format. To pull from other registries, include the hostname `registry.example.com/repo/image[:tag]`.
1. Click **Pull**.

[Docker Hub]:
https://hub.docker.com/

#### Building Images

Use this option to build an image and it to your virtual machine.

To build an image:

1. Click the **+** button in the top-right corner.
1. Click on the **Build** tab.
1. Enter a name for the image being built. E.g., `repo/image`, `repo/image:tag`, `registry.example.com/repo/image`, or `registry.example.com/repo/image:tag`.
1. Click **Build**.
1. In the file browser, select the Dockerfile to build an image with.

## Troubleshooting

### Show Logs

Use this option to open the folder containing all Rancher Desktop log files.

### Factory Reset

Remove the cluster and all other Rancher Desktop settings. The initial setup procedure must be done again.

To perform a factory reset:

1. Click **Reset**.
1. On the confirmation window, click **OK** to proceed. Kubernetes stops and Rancher Desktop closes.
1. Start Rancher Desktop again.