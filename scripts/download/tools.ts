import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  download, downloadZip, downloadTarGZ, getResource, DownloadOptions
} from '../lib/download';
import { DependencyVersions, DownloadContext, Platform, KubePlatform } from 'scripts/lib/dependencies';

function exeName(context: DownloadContext, name: string) {
  const onWindows = context.platform.startsWith('win');

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

async function downloadKuberlr(context: DownloadContext, version: string, arch: string): Promise<string> {
  const baseURL = `https://github.com/flavio/kuberlr/releases/download/v${ version }`;
  const platformDir = `kuberlr_${ version }_${ context.kubePlatform }_${ arch }`;
  const archiveName = platformDir + (context.kubePlatform.startsWith('win') ? '.zip' : '.tar.gz');

  const allChecksums = (await getResource(`${ baseURL }/checksums.txt`)).split(/\r?\n/);
  const checksums = allChecksums.filter(line => line.includes(platformDir));

  switch (checksums.length) {
  case 0:
    throw new Error(`Couldn't find a matching SHA for [${ platformDir }] in [${ allChecksums }]`);
  case 1:
    break;
  default:
    throw new Error(`Matched ${ checksums.length } hits, not exactly 1, for platform ${ context.kubePlatform } in [${ allChecksums }]`);
  }

  const options = {
    expectedChecksum: checksums[0].split(/\s+/)[0],
    entryName:        `${ platformDir }/${ exeName(context, 'kuberlr') }`,
  };

  const downloadFunc = context.platform.startsWith('win') ? downloadZip : downloadTarGZ;
  const binName = exeName(context, 'kuberlr');

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

async function downloadKuberlrAndKubectl(context: DownloadContext, version: string): Promise<void> {
  // We use the x86_64 version even on aarch64 because kubectl binaries before v1.21.0 are unavailable
  const kuberlrPath = await downloadKuberlr(context, version, 'amd64');
  const arch = process.env.M1 ? 'arm64' : 'amd64';

  await bindKubectlToKuberlr(kuberlrPath, path.join(context.binDir, exeName(context, 'kubectl')));

  if (context.platform === os.platform()) {
    // Download Kubectl into kuberlr's directory of versioned kubectl's
    const kubeVersion = (await getResource('https://dl.k8s.io/release/stable.txt')).trim();
    const kubectlURL = `https://dl.k8s.io/${ kubeVersion }/bin/${ context.kubePlatform }/${ arch }/${ exeName(context, 'kubectl') }`;
    const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
    const homeDir = await findHome(context.platform.startsWith('win'));
    const kuberlrDir = path.join(homeDir, '.kuberlr', `${ context.kubePlatform }-${ arch }`);
    const managedKubectlPath = path.join(kuberlrDir, exeName(context, `kubectl${ kubeVersion.replace(/^v/, '') }`));

    await download(kubectlURL, managedKubectlPath, { expectedChecksum: kubectlSHA });
  }
}

async function downloadHelm(context: DownloadContext, version: string): Promise<void> {
  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const arch = process.env.M1 ? 'arm64' : 'amd64';
  const helmURL = `https://get.helm.sh/helm-v${ version }-${ context.kubePlatform }-${ arch }.tar.gz`;

  await downloadTarGZ(helmURL, path.join(context.binDir, exeName(context, 'helm')), {
    expectedChecksum: (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0],
    entryName:        `${ context.kubePlatform }-${ arch }/${ exeName(context, 'helm') }`,
  });
}

async function downloadDockerCLI(context: DownloadContext, version: string): Promise<void> {
  const dockerPlatform = context.dependencyPlaform === 'wsl' ? 'wsl' : context.kubePlatform;
  const arch = process.env.M1 ? 'arm64' : 'amd64';
  const dockerURLBase = `https://github.com/rancher-sandbox/rancher-desktop-docker-cli/releases/download/${ version }`;
  const dockerExecutable = exeName(context, `docker-${ dockerPlatform }-${ arch }`);
  const dockerURL = `${ dockerURLBase }/${ dockerExecutable }`;
  const dockerPath = path.join(context.binDir, exeName(context, 'docker'));
  const dockerSHA = await findChecksum(`${ dockerURLBase }/sha256sum.txt`, dockerExecutable);

  await download(dockerURL, dockerPath, { expectedChecksum: dockerSHA });
}

async function downloadDockerBuildx(context: DownloadContext, version: string): Promise<void> {
  // Download the Docker-Buildx Plug-In
  const arch = process.env.M1 ? 'arm64' : 'amd64';
  const dockerBuildxURLBase = `https://github.com/docker/buildx/releases/download/${ version }`;
  const dockerBuildxExecutable = exeName(context, `buildx-${ version }.${ context.kubePlatform }-${ arch }`);
  const dockerBuildxURL = `${ dockerBuildxURLBase }/${ dockerBuildxExecutable }`;
  const dockerBuildxPath = path.join(context.binDir, exeName(context, 'docker-buildx'));
  const options: DownloadOptions = {};

  // No checksums available on the docker/buildx site for darwin builds
  // https://github.com/docker/buildx/issues/945
  if (context.kubePlatform !== 'darwin') {
    options.expectedChecksum = await findChecksum(`${ dockerBuildxURLBase }/checksums.txt`, dockerBuildxExecutable);
  }
  await download(dockerBuildxURL, dockerBuildxPath, options);
}

async function downloadDockerCompose(context: DownloadContext, version: string): Promise<void> {
  // Download the Docker-Compose Plug-In
  const dockerComposeURLBase = `https://github.com/docker/compose/releases/download/${ version }`;
  const dockerComposeCPU = process.env.M1 ? 'aarch64' : 'x86_64';
  const dockerComposeExecutable = exeName(context, `docker-compose-${ context.kubePlatform }-${ dockerComposeCPU }`);
  const dockerComposeURL = `${ dockerComposeURLBase }/${ dockerComposeExecutable }`;
  const dockerComposePath = path.join(context.binDir, exeName(context, 'docker-compose'));
  const dockerComposeSHA = await findChecksum(`${ dockerComposeURL }.sha256`, dockerComposeExecutable);

  await download(dockerComposeURL, dockerComposePath, { expectedChecksum: dockerComposeSHA });
}

async function downloadTrivy(context: DownloadContext, version: string): Promise<void> {
  // Download Trivy
  // Always run this in the VM, so download the *LINUX* version into internalDir
  // and move it over to the wsl/lima partition at runtime.
  // This will be needed when RD is ported to linux as well, because there might not be
  // an image client running on the host.
  // Sample URLs:
  // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_checksums.txt
  // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_macOS-64bit.tar.gz

  const versionWithV = `v${ version }`;
  const trivyURLBase = `https://github.com/aquasecurity/trivy/releases`;
  const trivyOS = process.env.M1 ? 'Linux-ARM64' : 'Linux-64bit';
  const trivyBasename = `trivy_${ version }_${ trivyOS }`;
  const trivyURL = `${ trivyURLBase }/download/${ versionWithV }/${ trivyBasename }.tar.gz`;
  const checksumURL = `${ trivyURLBase }/download/${ versionWithV }/trivy_${ version }_checksums.txt`;
  const trivySHA = await findChecksum(checksumURL, `${ trivyBasename }.tar.gz`);
  const trivyPath = path.join(context.internalDir, 'trivy');

  // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
  await downloadTarGZ(trivyURL, trivyPath, { expectedChecksum: trivySHA });
}

async function downloadGuestAgent(context: DownloadContext, version: string): Promise<void> {
  const baseUrl = `https://github.com/rancher-sandbox/rancher-desktop-agent/releases/download/${ version }`;
  const executableName = 'rancher-desktop-guestagent';
  const url = `${ baseUrl }/${ executableName }-${ version }.tar.gz`;
  const destPath = path.join(context.internalDir, executableName);

  await downloadTarGZ(url, destPath);
}

async function downloadSteve(context: DownloadContext, version: string): Promise<void> {
  const steveURLBase = `https://github.com/rancher-sandbox/rancher-desktop-steve/releases/download/${ version }`;
  const steveCPU = process.env.M1 ? 'arm64' : 'amd64';
  const steveExecutable = `steve-${ context.kubePlatform }-${ steveCPU }`;
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

async function downloadRancherDashboard(version: string): Promise<void> {
  // Download Rancher Dashboard
  const rancherDashboardURLBase = `https://github.com/rancher-sandbox/dashboard/releases/download/${ version }`;
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
function downloadDockerProvidedCredHelpers(context: DownloadContext, version: string): Promise<string[]> {
  const arch = process.env.M1 ? 'arm64' : 'amd64';
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
function downloadECRCredHelper(context: DownloadContext, version: string): Promise<void> {
  const arch = process.env.M1 ? 'arm64' : 'amd64';
  const ecrLoginPlatform = context.platform.startsWith('win') ? 'windows' : context.platform;
  const baseName = 'docker-credential-ecr-login';
  const baseUrl = 'https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com';
  const binName = context.platform.startsWith('win') ? `${ baseName }.exe` : baseName;
  const sourceUrl = `${ baseUrl }/${ version }/${ ecrLoginPlatform }-${ arch }/${ binName }`;
  const destPath = path.join(context.binDir, binName);

  return download(sourceUrl, destPath);
}

export default async function downloadDependencies(downloadContext: DownloadContext, depVersions: DependencyVersions): Promise<void> {
  await Promise.all([
    downloadKuberlrAndKubectl(downloadContext, depVersions.kuberlr),
    downloadHelm(downloadContext, depVersions.helm),
    downloadDockerCLI(downloadContext, depVersions.dockerCLI),
    downloadDockerBuildx(downloadContext, depVersions.dockerBuildx),
    downloadDockerCompose(downloadContext, depVersions.dockerCompose),
    downloadTrivy(downloadContext, depVersions.trivy),
    downloadSteve(downloadContext, depVersions.steve),
    downloadGuestAgent(downloadContext, depVersions.guestAgent),
    downloadRancherDashboard(depVersions.rancherDashboard),
    downloadDockerProvidedCredHelpers(downloadContext, depVersions.dockerProvidedCredentialHelpers),
    downloadECRCredHelper(downloadContext, depVersions.ECRCredenialHelper),
  ]);
}
