import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { download, downloadZip, downloadTarGZ, getResource } from '../lib/download.mjs';

/**
 * Find the home directory, in a way that is compatible with kuberlr
 *
 * @param {boolean} [onWindows] Whether we're running on Windows
 */
async function findHome(onWindows) {
  const tryAccess = async(path) => {
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

  return null;
}

async function downloadKuberlr(kubePlatform, cpu, destDir) {
  const kuberlrVersion = '0.4.1';
  const baseURL = `https://github.com/flavio/kuberlr/releases/download/v${ kuberlrVersion }`;
  const platformDir = `kuberlr_${ kuberlrVersion }_${ kubePlatform }_${ cpu }`;
  const archiveName = platformDir + (kubePlatform.startsWith('win') ? '.zip' : '.tar.gz');
  const exeName = kubePlatform.startsWith('win') ? 'kuberlr.exe' : 'kuberlr';

  const allChecksums = (await getResource(`${ baseURL }/checksums.txt`)).split(/\r?\n/);
  const checksums = allChecksums.filter(line => line.includes(platformDir));

  switch (checksums.length) {
  case 0:
    throw new Error(`Couldn't find a matching SHA for [${ platformDir }] in [${ allChecksums }]`);
  case 1:
    break;
  default:
    throw new Error(`Matched ${ checksums.length } hits, not exactly 1, for platform ${ kubePlatform } in [${ allChecksums }]`);
  }

  /** @type import('../lib/download.mjs').ArchiveDownloadOptions */
  const options = {
    expectedChecksum: checksums[0].split(/\s+/)[0],
    entryName:        `${ platformDir }/${ exeName }`,
  };

  if (kubePlatform.startsWith('win')) {
    return await downloadZip(`${ baseURL }/${ archiveName }`, path.join(destDir, exeName), options);
  }

  return await downloadTarGZ(`${ baseURL }/${ archiveName }`, path.join(destDir, exeName), options);
}

/**
 * Download the given checksum file (which contains multiple checksums) and find
 * the correct checksum for the given executable name.
 * @param {string} checksumURL The URL to download the checksum from.
 * @param {string} executableName The name of the executable expected.
 * @returns {Promise<string>} The checksum.
 */
async function findChecksum(checksumURL, executableName) {
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

export default async function main(platform) {
  /** The platform string, as used by golang / Kubernetes. */
  const kubePlatform = {
    darwin: 'darwin',
    linux:  'linux',
    win32:  'windows',
  }[platform];
  const resourcesDir = path.join(process.cwd(), 'resources', platform);
  const binDir = path.join(resourcesDir, 'bin');
  const onWindows = kubePlatform === 'windows';
  const cpu = process.env.M1 ? 'arm64' : 'amd64';

  function exeName(name) {
    return `${ name }${ onWindows ? '.exe' : '' }`;
  }

  fs.mkdirSync(binDir, { recursive: true });

  // We use the x86_64 version even on aarch64 because kubectl binaries before v1.21.0 are unavailable
  const kuberlrPath = await downloadKuberlr(kubePlatform, 'amd64', binDir);

  await bindKubectlToKuberlr(kuberlrPath, path.join(binDir, exeName('kubectl')));

  if (platform === os.platform()) {
    // Download Kubectl into kuberlr's directory of versioned kubectl's
    const kubeVersion = (await getResource('https://dl.k8s.io/release/stable.txt')).trim();
    const kubectlURL = `https://dl.k8s.io/${ kubeVersion }/bin/${ kubePlatform }/${ cpu }/${ exeName('kubectl') }`;
    const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
    const kuberlrDir = path.join(await findHome(onWindows), '.kuberlr', `${ kubePlatform }-${ cpu }`);
    const managedKubectlPath = path.join(kuberlrDir, exeName(`kubectl${ kubeVersion.replace(/^v/, '') }`));

    await download(kubectlURL, managedKubectlPath, { expectedChecksum: kubectlSHA });

    // Download go-swagger (build tool, for host only)
    const goSwaggerVersion = 'v0.28.0';
    const goSwaggerURLBase = `https://github.com/go-swagger/go-swagger/releases/download/${ goSwaggerVersion }`;
    const goSwaggerExecutable = exeName(`swagger_${ kubePlatform }_amd64`);
    const goSwaggerURL = `${ goSwaggerURLBase }/${ goSwaggerExecutable }`;
    const goSwaggerPath = path.join(process.cwd(), 'resources', 'host', exeName('swagger'));
    const goSwaggerSHA = await findChecksum(`${ goSwaggerURLBase }/sha256sum.txt`, goSwaggerExecutable);

    await download(goSwaggerURL, goSwaggerPath, { expectedChecksum: goSwaggerSHA });
  }

  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const helmVersion = '3.7.2';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-${ cpu }.tar.gz`;

  await downloadTarGZ(helmURL, path.join(binDir, exeName('helm')), {
    expectedChecksum: (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0],
    entryName:        `${ kubePlatform }-${ cpu }/${ exeName('helm') }`,
  });

  // Download Docker
  const dockerVersion = 'v20.10.9';
  const dockerURLBase = `https://github.com/rancher-sandbox/rancher-desktop-docker-cli/releases/download/${ dockerVersion }`;
  const dockerExecutable = exeName(`docker-${ kubePlatform }-${ cpu }`);
  const dockerURL = `${ dockerURLBase }/${ dockerExecutable }`;
  const dockerPath = path.join(binDir, exeName('docker'));
  const dockerSHA = await findChecksum(`${ dockerURLBase }/sha256sum.txt`, dockerExecutable);

  await download(dockerURL, dockerPath, { expectedChecksum: dockerSHA });

  // Download the Docker-Buildx Plug-In
  const dockerBuildxVersion = 'v0.7.1';
  const dockerBuildxURLBase = `https://github.com/docker/buildx/releases/download/${ dockerBuildxVersion }`;
  const dockerBuildxExecutable = exeName(`buildx-${ dockerBuildxVersion }.${ kubePlatform }-${ cpu }`);
  const dockerBuildxURL = `${ dockerBuildxURLBase }/${ dockerBuildxExecutable }`;
  const dockerBuildxPath = path.join(binDir, exeName('docker-buildx'));
  const dockerBuildxOptions = {};

  // No checksums available on the docker/buildx site for darwin builds
  // https://github.com/docker/buildx/issues/945
  if (kubePlatform !== 'darwin') {
    dockerBuildxOptions.expectedChecksum = await findChecksum(`${ dockerBuildxURLBase }/checksums.txt`, dockerBuildxExecutable);
  }
  await download(dockerBuildxURL, dockerBuildxPath, dockerBuildxOptions);

  // Download the Docker-Compose Plug-In
  const dockerComposeVersion = 'v2.2.3';
  const dockerComposeURLBase = `https://github.com/docker/compose/releases/download/${ dockerComposeVersion }`;
  const dockerComposeCPU = process.env.M1 ? 'aarch64' : 'x86_64';
  const dockerComposeExecutable = exeName(`docker-compose-${ kubePlatform }-${ dockerComposeCPU }`);
  const dockerComposeURL = `${ dockerComposeURLBase }/${ dockerComposeExecutable }`;
  const dockerComposePath = path.join(binDir, exeName('docker-compose'));
  const dockerComposeSHA = await findChecksum(`${ dockerComposeURL }.sha256`, dockerComposeExecutable);

  await download(dockerComposeURL, dockerComposePath, { expectedChecksum: dockerComposeSHA });

  // Download Trivy
  // Always run this in the VM, so download the *LINUX* version into binDir
  // and move it over to the wsl/lima partition at runtime.
  // This will be needed when RD is ported to linux as well, because there might not be
  // an image client running on the host.
  // Sample URLs:
  // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_checksums.txt
  // https://github.com/aquasecurity/trivy/releases/download/v0.18.3/trivy_0.18.3_macOS-64bit.tar.gz

  const trivyURLBase = 'https://github.com/aquasecurity/trivy/releases';
  const rawTrivyVersionJSON = spawnSync('curl', ['-k', '-L', '-H', 'Accept: application/json',
    `${ trivyURLBase }/latest`]).stdout.toString();
  const trivyVersionJSON = JSON.parse(rawTrivyVersionJSON);
  const trivyVersionWithV = trivyVersionJSON['tag_name'];
  const trivyVersion = trivyVersionWithV.replace(/^v/, '');
  const trivyOS = cpu === 'amd64' ? 'Linux-64bit' : 'Linux-ARM64';
  const trivyBasename = `trivy_${ trivyVersion }_${ trivyOS }`;
  const trivyURL = `${ trivyURLBase }/download/${ trivyVersionWithV }/${ trivyBasename }.tar.gz`;
  const trivySHA = await findChecksum(`${ trivyURLBase }/download/${ trivyVersionWithV }/trivy_${ trivyVersion }_checksums.txt`, `${ trivyBasename }.tar.gz`);

  // Grab a linux executable and put it in the linux/bin dir, which will probably need to be created
  const actualBinDir = path.join(process.cwd(), 'resources', 'linux', 'bin');

  await fs.promises.mkdir(actualBinDir, { recursive: true });
  // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
  await downloadTarGZ(trivyURL, path.join(actualBinDir, 'trivy'), { expectedChecksum: trivySHA });

  // Download Steve
  const steveVersion = '0.1.0-beta3';
  const steveURLBase = `https://github.com/rancher-sandbox/steve/releases/download/${ steveVersion }`;
  const steveCPU = process.env.M1 ? 'arm64' : 'amd64';
  const steveExecutable = `steve-${ kubePlatform }-${ steveCPU }`;
  const steveURL = `${ steveURLBase }/${ steveExecutable }.tar.gz`;
  const stevePath = path.join(binDir, exeName('steve'));
  const steveSHA = await findChecksum(`${ steveURL }.sha512sum`, steveExecutable);

  await downloadTarGZ(
    steveURL,
    stevePath,
    {
      expectedChecksum:  steveSHA,
      checksumAlgorithm: 'sha512'
    });

  downloadRancherDashboard();
}

/**
 * Desired: on Windows, .../bin/kubectl.exe is a copy of .../bin/kuberlr.exe
 *          elsewhere: .../bin/kubectl is a symlink to .../bin/kuberlr
 * @param kuberlrPath {string}
 * @param binKubectlPath {string}
 * @returns {Promise<void>}
 */
async function bindKubectlToKuberlr(kuberlrPath, binKubectlPath) {
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

async function downloadRancherDashboard() {
  // Download Rancher Dashboard
  const rancherDashboardVersion = 'desktop-v2.6.3.beta.2';
  const rancherDashboardURLBase = `https://github.com/rancher-sandbox/dashboard/releases/download/${ rancherDashboardVersion }`;
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
      access:            fs.constants.W_OK
    });

  await fs.promises.mkdir(rancherDashboardDir, { recursive: true });

  const args = ['tar', '-xf', rancherDashboardPath];

  if (os.platform().startsWith('win')) {
    // On Windows, force use the bundled bsdtar.
    // We may find GNU tar on the path, which looks at the Windows-style path
    // and considers C:\Temp to be a reference to a remote host named `C`.
    args[0] = path.join(process.env.SystemRoot, 'system32', 'tar.exe');
  }

  spawnSync(
    args[0],
    args.slice(1),
    {
      cwd:   rancherDashboardDir,
      stdio: 'inherit'
    });

  fs.rmSync(rancherDashboardPath, { maxRetries: 10 });
}
