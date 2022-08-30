import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import fetch from 'node-fetch';

import { DownloadContext, Dependency } from 'scripts/lib/dependencies';

import {
  download, downloadZip, downloadTarGZ, getResource, DownloadOptions, ArchiveDownloadOptions,
} from '../lib/download';

function exeName(context: DownloadContext, name: string) {
  const onWindows = context.platform === 'win32';

  return `${ name }${ onWindows ? '.exe' : '' }`;
}

/**
 * A lot of dependencies are hosted on Github via Github releases,
 * so the logic to fetch the latest version is very similar for
 * these releases. This lets us eliminate some of the duplication.
 */
class GithubVersionGetter {
  url = '';

  async getLatestVersion(): Promise<string> {
    const latestVersionWithV = await getLatestVersion(this.url);
    return latestVersionWithV.replace('v', '');
  }
}

/**
 * Find the home directory, in a way that is compatible with kuberlr.
 *
 * @param onWindows Whether we're running on Windows.
 */
async function findHome(onWindows: boolean): Promise<string> {
  const tryAccess = async(path: string) => {
    try {
      await fs.promises.access(path);

      return true;
    } catch {
      return false;
    }
  };

  const osHomeDir = os.homedir();

  if (osHomeDir && await tryAccess(osHomeDir)) {
    return osHomeDir;
  }
  if (process.env.HOME && await tryAccess(process.env.HOME)) {
    return process.env.HOME;
  }
  if (onWindows) {
    if (process.env.USERPROFILE && await tryAccess(process.env.USERPROFILE)) {
      return process.env.USERPROFILE;
    }
    if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
      const homePath = path.join(process.env.HOMEDRIVE, process.env.HOMEPATH);

      if (await tryAccess(homePath)) {
        return homePath;
      }
    }
  }

  throw new Error('Failed to find home directory');
}

async function downloadKuberlr(context: DownloadContext, version: string, arch: 'amd64' | 'arm64'): Promise<string> {
  const baseURL = `https://github.com/flavio/kuberlr/releases/download/v${ version }`;
  const platformDir = `kuberlr_${ version }_${ context.goPlatform }_${ arch }`;
  const archiveName = platformDir + (context.goPlatform.startsWith('win') ? '.zip' : '.tar.gz');
  const expectedChecksum = await findChecksum(`${ baseURL }/checksums.txt`, archiveName);
  const binName = exeName(context, 'kuberlr');
  const options: ArchiveDownloadOptions = {
    expectedChecksum,
    entryName: `${ platformDir }/${ binName }`,
  };
  const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;

  return await downloadFunc(`${ baseURL }/${ archiveName }`, path.join(context.binDir, binName), options);
}

/**
 * Download the given checksum file (which contains multiple checksums) and find
 * the correct checksum for the given executable name.
 * @param checksumURL The URL to download the checksum from.
 * @param executableName The name of the executable expected.
 * @returns The checksum.
 */
async function findChecksum(checksumURL: string, executableName: string): Promise<string> {
  const allChecksums = await getResource(checksumURL);
  const desiredChecksums = allChecksums.split(/\r?\n/).filter(line => line.includes(executableName));

  if (desiredChecksums.length < 1) {
    throw new Error(`Couldn't find a matching SHA for [${ executableName }] in [${ allChecksums }]`);
  }
  if (desiredChecksums.length === 1) {
    return desiredChecksums[0].split(/\s+/, 1)[0];
  }
  throw new Error(`Matched ${ desiredChecksums.length } hits, not exactly 1, for ${ executableName } in [${ allChecksums }]`);
}

/**
 * Desired: on Windows, .../bin/kubectl.exe is a copy of .../bin/kuberlr.exe
 *          elsewhere: .../bin/kubectl is a symlink to .../bin/kuberlr
 * @param kuberlrPath
 * @param binKubectlPath
 */
async function bindKubectlToKuberlr(kuberlrPath: string, binKubectlPath: string): Promise<void> {
  if (os.platform().startsWith('win')) {
    await fs.promises.copyFile(kuberlrPath, binKubectlPath);

    return;
  }
  try {
    const binKubectlStat = await fs.promises.lstat(binKubectlPath);

    if (binKubectlStat.isSymbolicLink()) {
      const actualTarget = await fs.promises.readlink(binKubectlPath);

      if (actualTarget === 'kuberlr') {
        // The link is already there
        return;
      } else {
        console.log(`Deleting symlink ${ binKubectlPath } unexpectedly pointing to ${ actualTarget }`);
      }
    }
    await fs.promises.rm(binKubectlPath);
  } catch (_) {
    // .../bin/kubectl doesn't exist, so there's nothing to clean up
  }
  await fs.promises.symlink('kuberlr', binKubectlPath);
}

export class KuberlrAndKubectl extends GithubVersionGetter implements Dependency {
  name = 'kuberlr';
  url = 'https://api.github.com/repos/flavio/kuberlr/releases';

  async download(context: DownloadContext): Promise<void> {
    // We use the x86_64 version even on aarch64 because kubectl binaries before v1.21.0 are unavailable
    const kuberlrPath = await downloadKuberlr(context, context.versions.kuberlr, 'amd64');
    const arch = context.isM1 ? 'arm64' : 'amd64';

    await bindKubectlToKuberlr(kuberlrPath, path.join(context.binDir, exeName(context, 'kubectl')));

    if (context.platform === os.platform()) {
      // Download Kubectl into kuberlr's directory of versioned kubectl's
      const kubeVersion = (await getResource('https://dl.k8s.io/release/stable.txt')).trim();
      const kubectlURL = `https://dl.k8s.io/${ kubeVersion }/bin/${ context.goPlatform }/${ arch }/${ exeName(context, 'kubectl') }`;
      const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
      const homeDir = await findHome(context.platform === 'win32');
      const kuberlrDir = path.join(homeDir, '.kuberlr', `${ context.goPlatform }-${ arch }`);
      const managedKubectlPath = path.join(kuberlrDir, exeName(context, `kubectl${ kubeVersion.replace(/^v/, '') }`));

      await download(kubectlURL, managedKubectlPath, { expectedChecksum: kubectlSHA });
    }
  }
}

export class Helm extends GithubVersionGetter implements Dependency {
  name = 'helm';
  url = 'https://api.github.com/repos/helm/helm/releases';

  async download(context: DownloadContext): Promise<void> {
    // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const helmURL = `https://get.helm.sh/helm-v${ context.versions.helm }-${ context.goPlatform }-${ arch }.tar.gz`;

    await downloadTarGZ(helmURL, path.join(context.binDir, exeName(context, 'helm')), {
      expectedChecksum: (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0],
      entryName:        `${ context.goPlatform }-${ arch }/${ exeName(context, 'helm') }`,
    });
  }
}

export class DockerCLI extends GithubVersionGetter implements Dependency {
  name = 'dockerCLI';
  url = 'https://api.github.com/repos/rancher-sandbox/rancher-desktop-docker-cli/releases';

  async download(context: DownloadContext): Promise<void> {
    const dockerPlatform = context.dependencyPlaform === 'wsl' ? 'wsl' : context.goPlatform;
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const dockerURLBase = `https://github.com/rancher-sandbox/rancher-desktop-docker-cli/releases/download/v${ context.versions.dockerCLI }`;
    const dockerExecutable = exeName(context, `docker-${ dockerPlatform }-${ arch }`);
    const dockerURL = `${ dockerURLBase }/${ dockerExecutable }`;
    const dockerPath = path.join(context.binDir, exeName(context, 'docker'));
    const dockerSHA = await findChecksum(`${ dockerURLBase }/sha256sum.txt`, dockerExecutable);

    await download(dockerURL, dockerPath, { expectedChecksum: dockerSHA });
  }
}

export class DockerBuildx extends GithubVersionGetter implements Dependency {
  name = 'dockerBuildx';
  url = 'https://api.github.com/repos/docker/buildx/releases';

  async download(context: DownloadContext): Promise<void> {
    // Download the Docker-Buildx Plug-In
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const baseURL = `https://github.com/docker/buildx/releases/download/v${ context.versions.dockerBuildx }`;
    const executableName = exeName(context, `buildx-v${ context.versions.dockerBuildx }.${ context.goPlatform }-${ arch }`);
    const dockerBuildxURL = `${ baseURL }/${ executableName }`;
    const dockerBuildxPath = path.join(context.binDir, exeName(context, 'docker-buildx'));
    const options: DownloadOptions = {};

    // No checksums available on the docker/buildx site for darwin builds
    // https://github.com/docker/buildx/issues/945
    if (context.goPlatform !== 'darwin') {
      options.expectedChecksum = await findChecksum(`${ baseURL }/checksums.txt`, executableName);
    }
    await download(dockerBuildxURL, dockerBuildxPath, options);
  }
}

export class DockerCompose extends GithubVersionGetter implements Dependency {
  name = 'dockerCompose';
  url = 'https://api.github.com/repos/docker/compose/releases';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/docker/compose/releases/download/v${ context.versions.dockerCompose }`;
    const arch = context.isM1 ? 'aarch64' : 'x86_64';
    const executableName = exeName(context, `docker-compose-${ context.goPlatform }-${ arch }`);
    const url = `${ baseUrl }/${ executableName }`;
    const destPath = path.join(context.binDir, exeName(context, 'docker-compose'));
    const expectedChecksum = await findChecksum(`${ url }.sha256`, executableName);

    await download(url, destPath, { expectedChecksum });
  }
}

export class Trivy extends GithubVersionGetter implements Dependency {
  name = 'trivy';
  url = 'https://api.github.com/repos/aquasecurity/trivy/releases';

  async download(context: DownloadContext): Promise<void> {
    // Download Trivy
    // Always run this in the VM, so download the *LINUX* version into internalDir
    // and move it over to the wsl/lima partition at runtime.
    // Sample URLs:
    // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_checksums.txt
    // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_macOS-64bit.tar.gz

    const versionWithV = `v${ context.versions.trivy }`;
    const trivyURLBase = `https://github.com/aquasecurity/trivy/releases`;
    const trivyOS = context.isM1 ? 'Linux-ARM64' : 'Linux-64bit';
    const trivyBasename = `trivy_${ context.versions.trivy }_${ trivyOS }`;
    const trivyURL = `${ trivyURLBase }/download/${ versionWithV }/${ trivyBasename }.tar.gz`;
    const checksumURL = `${ trivyURLBase }/download/${ versionWithV }/trivy_${ context.versions.trivy }_checksums.txt`;
    const trivySHA = await findChecksum(checksumURL, `${ trivyBasename }.tar.gz`);
    const trivyPath = path.join(context.resourcesDir, 'linux', 'internal', 'trivy');

    // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
    await downloadTarGZ(trivyURL, trivyPath, { expectedChecksum: trivySHA });
  }
}

export class Steve extends GithubVersionGetter implements Dependency {
  name = 'steve';
  url = 'https://api.github.com/repos/rancher-sandbox/rancher-desktop-steve/releases';

  async download(context: DownloadContext): Promise<void> {
    const steveURLBase = `https://github.com/rancher-sandbox/rancher-desktop-steve/releases/download/v${ context.versions.steve }`;
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const steveExecutable = `steve-${ context.goPlatform }-${ arch }`;
    const steveURL = `${ steveURLBase }/${ steveExecutable }.tar.gz`;
    const stevePath = path.join(context.internalDir, exeName(context, 'steve'));
    const steveSHA = await findChecksum(`${ steveURL }.sha512sum`, steveExecutable);

    await downloadTarGZ(
      steveURL,
      stevePath,
      {
        expectedChecksum:  steveSHA,
        checksumAlgorithm: 'sha512',
      });
  }
}

export class GuestAgent extends GithubVersionGetter implements Dependency {
  name = 'guestAgent';
  url = 'https://api.github.com/repos/rancher-sandbox/rancher-desktop-agent/releases';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://github.com/rancher-sandbox/rancher-desktop-agent/releases/download/${ context.versions.guestAgent }`;
    const executableName = 'rancher-desktop-guestagent';
    const url = `${ baseUrl }/${ executableName }-${ context.versions.guestAgent }.tar.gz`;
    const destPath = path.join(context.internalDir, executableName);

    await downloadTarGZ(url, destPath);
  }
}

export class RancherDashboard implements Dependency {
  name = 'rancherDashboard';
  async download(context: DownloadContext): Promise<void> {
    const baseURL = `https://github.com/rancher-sandbox/dashboard/releases/download/${ context.versions.rancherDashboard }`;
    const executableName = 'rancher-dashboard-desktop-embed';
    const url = `${ baseURL }/${ executableName }.tar.gz`;
    const destPath = path.join(context.resourcesDir, 'rancher-dashboard.tgz');
    const expectedChecksum = await findChecksum(`${ url }.sha512sum`, executableName);
    const rancherDashboardDir = path.join(context.resourcesDir, 'rancher-dashboard');

    if (fs.existsSync(rancherDashboardDir)) {
      console.log(`${ rancherDashboardDir } already exists, not re-downloading.`);

      return;
    }

    await download(
      url,
      destPath,
      {
        expectedChecksum,
        checksumAlgorithm: 'sha512',
        access:            fs.constants.W_OK,
      });

    await fs.promises.mkdir(rancherDashboardDir, { recursive: true });

    const args = ['tar', '-xf', destPath];

    if (os.platform().startsWith('win')) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      const systemRoot = process.env.SystemRoot;

      if (!systemRoot) {
        throw new Error('Could not find system root');
      }
      args[0] = path.join(systemRoot, 'system32', 'tar.exe');
    }

    spawnSync(
      args[0],
      args.slice(1),
      {
        cwd:   rancherDashboardDir,
        stdio: 'inherit',
      });

    fs.rmSync(destPath, { maxRetries: 10 });
  }

  async getLatestVersion(): Promise<string> {
    // The format of the Rancher Dashboard version is such that we don't want to
    // remove 'v' from it.
    const url = 'https://api.github.com/repos/rancher-sandbox/dashboard/releases';
    return await getLatestVersion(url);
  }
}

export class DockerProvidedCredHelpers extends GithubVersionGetter implements Dependency {
  name = 'dockerProvidedCredentialHelpers';
  url = 'https://api.github.com/repos/docker/docker-credential-helpers/releases';

  async download(context: DownloadContext): Promise<void> {
    const arch = context.isM1 ? 'arm64' : 'amd64';
    const version = context.versions.dockerProvidedCredentialHelpers;
    const extension = context.platform.startsWith('win') ? 'zip' : 'tar.gz';
    const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;
    const credHelperNames = {
      linux:  ['docker-credential-secretservice', 'docker-credential-pass'],
      darwin: ['docker-credential-osxkeychain'],
      win32:  ['docker-credential-wincred'],
    }[context.platform];
    const promises = [];
    const baseUrl = 'https://github.com/docker/docker-credential-helpers/releases/download';

    for (const baseName of credHelperNames) {
      const sourceUrl = `${ baseUrl }/v${ version }/${ baseName }-v${ version }-${ arch }.${ extension }`;
      const binName = context.platform.startsWith('win') ? `${ baseName }.exe` : baseName;
      const destPath = path.join(context.binDir, binName);

      promises.push(downloadFunc(sourceUrl, destPath));
    }

    await Promise.all(promises);
  }
}

/**
 * Download the version of docker-credential-ecr-login for a specific platform.
 */
export function downloadECRCredHelper(context: DownloadContext): Promise<void> {
  const arch = context.isM1 ? 'arm64' : 'amd64';
  const ecrLoginPlatform = context.platform.startsWith('win') ? 'windows' : context.platform;
  const baseName = 'docker-credential-ecr-login';
  const baseUrl = 'https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com';
  const binName = exeName(context, baseName);
  const sourceUrl = `${ baseUrl }/${ context.versions.ECRCredenialHelper }/${ ecrLoginPlatform }-${ arch }/${ binName }`;
  const destPath = path.join(context.binDir, binName);

  return download(sourceUrl, destPath);
}

// We don't use https://api.github.com/repos/OWNER/REPO/releases/latest because
// it appears to not work for rancher-sandbox/dashboard (because it is a fork?).
async function getLatestVersion(url: string): Promise<string> {
  const password = process.env.GITHUB_TOKEN;
  if (!password) {
    throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
  };
  const user = process.env.GITHUB_USER;
  if (!user) {
    throw new Error('Please set GITHUB_USER to a github username to check versions of github-based dependencies.');
  };
  const response = await fetch(url, { headers: {
      'Authorization': 'Basic ' + Buffer.from(`${ user }:${ password }`).toString('base64'),
    }
  });
  const responseAsJSON = await response.json();
  return responseAsJSON[0].name;
}
