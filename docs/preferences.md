# Preferences

## General

The **General** tab, provides general information about the project's status as well as links to discuss the project, report issues, or to learn more about the project.

### Check for updates automatically

When an update is available, users will be provided a notification and the release notes for the upgrade target. This happens whether automatic updates are enabled or not. If this option is enabled, the update will be downloaded and then installed the next time Rancher Desktop is started.

### Allow collection of anonymous statistics to help us improve Rancher Desktop

This option allows Rancher Desktop to collect information on how you interact with the Rancher Desktop application. Information such as what workloads you run are not collected.

## Kubernetes Settings

On the **Kubernetes Settings** tab, you can manage the settings of your virtual machine.

### Kubernetes Version

This option presents a list of Kubernetes versions that your Rancher Desktop instance can use. 

When upgrading:

- A check will is performed to see if the target Kubernetes version is available locally. If not, it will download the files.
- Workloads will be retained.
- Images are retained.

When downgrading:

- Workloads will be removed.
- Images are retained.

To switch versions:

1. Click the **Kubernetes version** drop-down menu.
1. Select the version you want to change to.
1. On the confirmation window, click **OK** to proceed.

### Memory (macOS & Linux)

The amount of memory to allocate to Rancher Desktop. The selectable range will be based your system. The red area within the range indicates an allocation that may affect system services.

This option is not available for Rancher Desktop on Windows. With WSL, memory allocation is configured globally across all Linux distributions. Refer to the [WSL documentation] for instructions.

[WSL documentation]:
https://docs.microsoft.com/en-us/windows/wsl/wsl-config#options-for-wslconfig

### CPUs (macOS & Linux)

The number of CPUs to allocate to Rancher Desktop. The selectable range will be based your system. The red area within the range indicates an allocation that may affect system services.

This option is not available for Rancher Desktop on Windows. With WSL, CPU allocation is configured globally across all Linux distributions. Refer to the [WSL documentation] for instructions.

[WSL documentation]:
https://docs.microsoft.com/en-us/windows/wsl/wsl-config#options-for-wslconfig

### Port

Set the port Kubernetes is exposed on. Use this setting to avoid port collisions if multiple instances of K3s are running.

### Reset Kubernetes/Reset Kubernetes and Container Images

This option removes all workloads and Kubernetes configurations. 
Images that have been pulled are not removed when a reset occurs.
1. On the confirmation window, click **OK** to proceed.

At this point, Kubernetes will be stopped then workloads and configurations will be removed. Kubernetes will then be started again.

## WSL Integration (Windows)

The **WSL Integration** tab gives the option to make the Rancher Desktop Kubernetes configuration accessible to any Linux distributions configured for WSL. Once enabled, you can use communicate with the Rancher Desktop Kubernetes cluster using tools like `kubectl` from within the WSL distribution.

## Port Forwarding (Windows)

To forward a port:

1. Find the service and click **Forward**. A random port will be assigned.
1. Optional: click **Cancel** to remove the port assigned.

## Supporting Utilities (macOS & Linux)

On the **Supporting Utilities** tab, you can create symbolic links to tools in /usr/local/bin. By default, a symbolic links will be created if the tool is not already linked.

Symbolic links can be created (or removed) for the following tools, which are installed as part Rancher Desktop:

- helm
- kim
- kubectl
- nerdctl

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

### Image Acquisition

#### Pulling Images

Use this option to pull images from a registry to your virtual machine.

To pull an image:

1. Click the **Name of image to pull** field.
1. By default, images will are pulled from [Docker Hub] in which case enter the `repository/image[:tag]` to pull from. E.g. `rancher/rancher` or `rancher/rancher:v2.6.1`. Otherwise, append the `repository/image[:tag]` to a registry path. E.g., `ghcr.io/example-org/example-image:test`.
1. Click **Pull Image**.

[Docker Hub]:
https://hub.docker.com/

#### Building Images

1. Click the **Name of image to build** field.
1. Enter a tag for the image. E.g., `my-repo/my-image` or `my-repo/my-image:latest`.
1. Click **Build Image**.
1. In the file browser, select the Dockerfile to build an image with.

## Troubleshooting

### Show Logs

Use this option to open the folder containing all Rancher Desktop log files.

### Factory Reset

Remove the cluster and all other Rancher Desktop settings. The initial setup procedure will need to be done again.

To perform a factory reset:

1. Click **Reset**.
1. On the confirmation window, click **OK** to proceed. Kubernetes will be stopped and Rancher Desktop will close.
1. Start Rancher Desktop again.