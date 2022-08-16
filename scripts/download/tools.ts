import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DependencyVersions, DownloadContext } from 'scripts/lib/dependencies';

import {
  download, downloadZip, downloadTarGZ, getResource, DownloadOptions, ArchiveDownloadOptions,
} from '../lib/download';

function exeName(context: DownloadContext, name: string) {
  const onWindows = context.platform === 'win32';

  return `${ name }${ onWindows ? '.exe' : '' }`;
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

async function downloadKuberlrAndKubectl(context: DownloadContext): Promise<void> {
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

async function downloadHelm(context: DownloadContext): Promise<void> {
  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const arch = context.isM1 ? 'arm64' : 'amd64';
  const helmURL = `https://get.helm.sh/helm-v${ context.versions.helm }-${ context.goPlatform }-${ arch }.tar.gz`;

  await downloadTarGZ(helmURL, path.join(context.binDir, exeName(context, 'helm')), {
    expectedChecksum: (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0],
    entryName:        `${ context.goPlatform }-${ arch }/${ exeName(context, 'helm') }`,
  });
}

async function downloadDockerCLI(context: DownloadContext): Promise<void> {
  const dockerPlatform = context.dependencyPlaform === 'wsl' ? 'wsl' : context.goPlatform;
  const arch = context.isM1 ? 'arm64' : 'amd64';
  const dockerURLBase = `https://github.com/rancher-sandbox/rancher-desktop-docker-cli/releases/download/${ context.versions.dockerCLI }`;
  const dockerExecutable = exeName(context, `docker-${ dockerPlatform }-${ arch }`);
  const dockerURL = `${ dockerURLBase }/${ dockerExecutable }`;
  const dockerPath = path.join(context.binDir, exeName(context, 'docker'));
  const dockerSHA = await findChecksum(`${ dockerURLBase }/sha256sum.txt`, dockerExecutable);

  await download(dockerURL, dockerPath, { expectedChecksum: dockerSHA });
}

async function downloadDockerBuildx(context: DownloadContext): Promise<void> {
  // Download the Docker-Buildx Plug-In
  const arch = context.isM1 ? 'arm64' : 'amd64';
  const dockerBuildxURLBase = `https://github.com/docker/buildx/releases/download/${ context.versions.dockerBuildx }`;
  const dockerBuildxExecutable = exeName(context, `buildx-${ context.versions.dockerBuildx }.${ context.goPlatform }-${ arch }`);
  const dockerBuildxURL = `${ dockerBuildxURLBase }/${ dockerBuildxExecutable }`;
  const dockerBuildxPath = path.join(context.binDir, exeName(context, 'docker-buildx'));
  const options: DownloadOptions = {};

  // No checksums available on the docker/buildx site for darwin builds
  // https://github.com/docker/buildx/issues/945
  if (context.goPlatform !== 'darwin') {
    options.expectedChecksum = await findChecksum(`${ dockerBuildxURLBase }/checksums.txt`, dockerBuildxExecutable);
  }
  await download(dockerBuildxURL, dockerBuildxPath, options);
}

async function downloadDockerCompose(context: DownloadContext): Promise<void> {
  // Download the Docker-Compose Plug-In
  const dockerComposeURLBase = `https://github.com/docker/compose/releases/download/${ context.versions.dockerCompose }`;
  const arch = context.isM1 ? 'aarch64' : 'x86_64';
  const dockerComposeExecutable = exeName(context, `docker-compose-${ context.goPlatform }-${ arch }`);
  const dockerComposeURL = `${ dockerComposeURLBase }/${ dockerComposeExecutable }`;
  const dockerComposePath = path.join(context.binDir, exeName(context, 'docker-compose'));
  const dockerComposeSHA = await findChecksum(`${ dockerComposeURL }.sha256`, dockerComposeExecutable);

  await download(dockerComposeURL, dockerComposePath, { expectedChecksum: dockerComposeSHA });
}

async function downloadTrivy(context: DownloadContext): Promise<void> {
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

async function downloadGuestAgent(context: DownloadContext): Promise<void> {
  const baseUrl = `https://github.com/rancher-sandbox/rancher-desktop-agent/releases/download/${ context.versions.guestAgent }`;
  const executableName = 'rancher-desktop-guestagent';
  const url = `${ baseUrl }/${ executableName }-${ context.versions.guestAgent }.tar.gz`;
  const destPath = path.join(context.resourcesDir, 'linux', 'internal', executableName);

  await downloadTarGZ(url, destPath);
}

async function downloadSteve(context: DownloadContext): Promise<void> {
  const steveURLBase = `https://github.com/rancher-sandbox/rancher-desktop-steve/releases/download/${ context.versions.steve }`;
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

async function downloadRancherDashboard(context: DownloadContext): Promise<void> {
  // Download Rancher Dashboard
  const rancherDashboardURLBase = `https://github.com/rancher-sandbox/dashboard/releases/download/${ context.versions.rancherDashboard }`;
  const rancherDashboardExecutable = 'rancher-dashboard-desktop-embed';
  const rancherDashboardURL = `${ rancherDashboardURLBase }/${ rancherDashboardExecutable }.tar.gz`;
  const resourcesRoot = path.join(process.cwd(), 'resources');
  const rancherDashboardPath = path.join(resourcesRoot, 'rancher-dashboard.tgz');
  const rancherDashboardSHA = await findChecksum(`${ rancherDashboardURL }.sha512sum`, rancherDashboardExecutable);
  const rancherDashboardDir = path.join(resourcesRoot, 'rancher-dashboard');

  if (fs.existsSync(rancherDashboardDir)) {
    console.log(`${ rancherDashboardDir } already exists, not re-downloading.`);

    return;
  }

  await download(
    rancherDashboardURL,
    rancherDashboardPath,
    {
      expectedChecksum:  rancherDashboardSHA,
      checksumAlgorithm: 'sha512',
      access:            fs.constants.W_OK,
    });

  await fs.promises.mkdir(rancherDashboardDir, { recursive: true });

  const args = ['tar', '-xf', rancherDashboardPath];

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

  fs.rmSync(rancherDashboardPath, { maxRetries: 10 });
}

/**
 * Download the docker-provided credential helpers for a specific platform.
 * @param platform The platform we're downloading for.
 * @param destDir The directory to place downloaded cred helpers in.
 */
function downloadDockerProvidedCredHelpers(context: DownloadContext): Promise<string[]> {
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

  return Promise.all(promises);
}

/**
 * Download the version of docker-credential-ecr-login for a specific platform.
 * @param platform The platform we're downloading for.
 * @param destDir The directory to place downloaded cred helper in.
 */
function downloadECRCredHelper(context: DownloadContext): Promise<void> {
  const arch = context.isM1 ? 'arm64' : 'amd64';
  const ecrLoginPlatform = context.platform.startsWith('win') ? 'windows' : context.platform;
  const baseName = 'docker-credential-ecr-login';
  const baseUrl = 'https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com';
  const binName = exeName(context, baseName);
  const sourceUrl = `${ baseUrl }/${ context.versions.ECRCredenialHelper }/${ ecrLoginPlatform }-${ arch }/${ binName }`;
  const destPath = path.join(context.binDir, binName);

  return download(sourceUrl, destPath);
}

export default async function downloadDependencies(downloadContext: DownloadContext, depVersions: DependencyVersions): Promise<void> {
  await Promise.all([
    downloadKuberlrAndKubectl(downloadContext),
    downloadHelm(downloadContext),
    downloadDockerCLI(downloadContext),
    downloadDockerBuildx(downloadContext),
    downloadDockerCompose(downloadContext),
    downloadTrivy(downloadContext),
    downloadSteve(downloadContext),
    downloadGuestAgent(downloadContext),
    downloadRancherDashboard(downloadContext),
    downloadDockerProvidedCredHelpers(downloadContext),
    downloadECRCredHelper(downloadContext),
  ]);
}
