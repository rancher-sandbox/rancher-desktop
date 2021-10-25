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

async function downloadKuberlr(kubePlatform, destDir) {
  const kuberlrVersion = '0.4.1';
  const baseURL = `https://github.com/flavio/kuberlr/releases/download/v${ kuberlrVersion }`;
  const platformDir = `kuberlr_${ kuberlrVersion }_${ kubePlatform }_amd64`;
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

  function exeName(name) {
    return `${ name }${ onWindows ? '.exe' : '' }`;
  }

  fs.mkdirSync(binDir, { recursive: true });

  const kuberlrPath = await downloadKuberlr(kubePlatform, binDir);

  await bindKubectlToKuberlr(kuberlrPath, path.join(binDir, exeName('kubectl')));

  // Download Kubectl into kuberlr's directory of versioned kubectl's
  if (platform === os.platform()) {
    const kubeVersion = (await getResource('https://dl.k8s.io/release/stable.txt')).trim();
    const kubectlURL = `https://dl.k8s.io/${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
    const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
    const kuberlrDir = path.join(await findHome(onWindows), '.kuberlr', `${ kubePlatform }-amd64`);
    const managedKubectlPath = path.join(kuberlrDir, exeName(`kubectl${ kubeVersion.replace(/^v/, '') }`));

    await download(kubectlURL, managedKubectlPath, { expectedChecksum: kubectlSHA });
  }

  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const helmVersion = '3.6.3';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-amd64.tar.gz`;

  await downloadTarGZ(helmURL, path.join(binDir, exeName('helm')), {
    expectedChecksum: (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0],
    entryName:        `${ kubePlatform }-amd64/${ exeName('helm') }`,
  });

  // Download Docker
  const dockerVersion = 'v20.10.9';
  const dockerURLBase = `https://github.com/rancher-sandbox/rancher-desktop-docker-cli/releases/download/${ dockerVersion }`;
  const dockerExecutable = exeName(`docker-${ kubePlatform }-amd64`);
  const dockerURL = `${ dockerURLBase }/${ dockerExecutable }`;
  const dockerPath = path.join(binDir, exeName('docker'));
  const allDockerSHAs = await getResource(`${ dockerURLBase }/sha256sum.txt`);
  const dockerSHA = allDockerSHAs.split(/\r?\n/).filter(line => line.includes(dockerExecutable));

  switch (dockerSHA.length) {
  case 0:
    throw new Error(`Couldn't find a matching SHA for [docker-${ kubePlatform }-amd64] in [${ allDockerSHAs }]`);
  case 1:
    break;
  default:
    throw new Error(`Matched ${ dockerSHA.length } hits, not exactly 1, for platform ${ kubePlatform } in [${ allDockerSHAs }]`);
  }
  await download(dockerURL, dockerPath, { expectedChecksum: dockerSHA[0].split(/\s+/, 1)[0] });

  // Download Kim
  const kimVersion = '0.1.0-beta.7';
  const kimURLBase = `https://github.com/rancher/kim/releases/download/v${ kimVersion }`;
  const kimURL = `${ kimURLBase }/${ exeName(`kim-${ kubePlatform }-amd64`) }`;
  const kimPath = path.join(binDir, exeName('kim'));
  const allKimSHAs = await getResource(`${ kimURLBase }/sha256sum.txt`);
  const kimSHA = allKimSHAs.split(/\r?\n/).filter(line => line.includes(`kim-${ kubePlatform }-amd64`));

  switch (kimSHA.length) {
  case 0:
    throw new Error(`Couldn't find a matching SHA for [kim-${ kubePlatform }-amd64] in [${ allKimSHAs }]`);
  case 1:
    break;
  default:
    throw new Error(`Matched ${ kimSHA.length } hits, not exactly 1, for platform ${ kubePlatform } in [${ allKimSHAs }]`);
  }
  await download(kimURL, kimPath, { expectedChecksum: kimSHA[0].split(/\s+/, 1)[0] });

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
  const trivyBasename = `trivy_${ trivyVersion }_Linux-64bit`;
  const trivyURL = `${ trivyURLBase }/download/${ trivyVersionWithV }/${ trivyBasename }.tar.gz`;
  const allTrivySHAs = await getResource(`${ trivyURLBase }/download/${ trivyVersionWithV }/trivy_${ trivyVersion }_checksums.txt`);
  const trivySHA = allTrivySHAs.split(/\r?\n/).filter(line => line.includes(`${ trivyBasename }.tar.gz`));

  switch (trivySHA.length) {
  case 0:
    throw new Error(`Couldn't find a matching SHA for [${ trivyBasename }.tar.gz] in [${ allTrivySHAs }]`);
  case 1:
    break;
  default:
    throw new Error(`Matched ${ trivySHA.length } hits, not exactly 1, for release ${ trivyBasename } in [${ allTrivySHAs }]`);
  }

  // Grab a linux executable and put it in the linux/bin dir, which will probably need to be created
  const actualBinDir = path.join(process.cwd(), 'resources', 'linux', 'bin');

  await fs.promises.mkdir(actualBinDir, { recursive: true });
  // trivy.tgz files are top-level tarballs - not wrapped in a labelled directory :(
  await downloadTarGZ(trivyURL, path.join(actualBinDir, 'trivy'), { expectedChecksum: trivySHA[0].split(/\s+/, 1)[0] });
}

/**
 * Desired: on Windows, .../bin/kubectl.exe is a copy of .../bin/kuberlr.exe
 *          elsewhere: .../bin/kubectl is a symlink to .../bin/kuberlr
 * @param kuberlrPath {string}
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
