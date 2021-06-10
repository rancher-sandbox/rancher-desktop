import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import download from '../src/utils/download.mjs';

function exeName(name) {
  return `${ name }${ os.platform() === 'win32' ? '.exe' : '' }`;
}

/**
 * Execute a process and wait for it to finish.
 * @param command {readonly string} The executable to run.
 * @param args {readonly string[]} Arguments to the executable.
 */
function spawnSync(command, ...args) {
  /** @type {childProcess.SpawnOptions} */
  const options = { stdio: 'inherit', windowsHide: true };
  const { status, signal, error } = childProcess.spawnSync(command, args, options);

  if (error) {
    throw error;
  }
  if (signal !== null && signal !== 'SIGTERM') {
    throw new Error(`${ command } exited with signal ${ signal }`);
  }
  if (status !== null && status !== 0) {
    throw new Error(`${ command } exited with status ${ status }`);
  }
}

/** The platform string, as used by golang / Kubernetes. */
const kubePlatform = {
  darwin: 'darwin',
  linux:  'linux',
  win32:  'windows',
}[os.platform()];
const resourcesDir = path.join(process.cwd(), 'resources', os.platform());
const binDir = path.join(resourcesDir, 'bin');
const onWindows = kubePlatform.startsWith('win');

// Download a tar.gz file to a temp dir, expand,
// and move the expected binary to the final dir
async function downloadTarGZ(url, binaryBasename, tgzPlatformDir) {
  const tgzDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  let binaryFinalPath = '';

  try {
    const tgzPath = path.join(tgzDir, `${ binaryBasename }.tar.gz`);
    const args = ['tar', '-zxvf', tgzPath, '--directory', tgzDir];

    await download(url, tgzPath, false, fs.constants.W_OK);
    if (os.platform().startsWith('win')) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      args[0] = path.join(process.env.SystemRoot, 'system32', 'tar.exe');
    }
    spawnSync(...args);
    binaryFinalPath = path.join(binDir, exeName(binaryBasename));
    fs.copyFileSync(path.join(tgzDir, tgzPlatformDir, exeName(binaryBasename)), binaryFinalPath);
    fs.chmodSync(binaryFinalPath, 0o755);
  } finally {
    console.log('finishing...');
    fs.rmSync(tgzDir, { recursive: true, maxRetries: 10 });
  }

  return binaryFinalPath;
}

// Download a zip file to a temp dir, expand,
// and move the expected binary to the final dir
async function downloadZip(url, binaryBasename, zipPlatformDir) {
  const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  let binaryFinalPath = '';

  try {
    const zipPath = path.join(zipDir, `${ binaryBasename }.zip`);
    const args = ['unzip', '-o', zipPath, '-d', zipDir];

    await download(url, zipPath, false, fs.constants.W_OK);
    spawnSync(...args);
    binaryFinalPath = path.join(binDir, exeName(binaryBasename));
    fs.copyFileSync(path.join(zipDir, zipPlatformDir, exeName(binaryBasename)), binaryFinalPath);
    fs.chmodSync(binaryFinalPath, 0o755);
  } finally {
    console.log('finishing...');
    fs.rmSync(zipDir, { recursive: true, maxRetries: 10 });
  }

  return binaryFinalPath;
}

function getHome() {
  const home = process.env.HOME || process.env.HOMEDRIVE + process.env.HOMEPATH;

  if (home) {
    return home;
  }
  throw new Error("Can't determine the home directory");
}

export default async function main() {
  fs.mkdirSync(binDir, { recursive: true });

  // Download Kubectl
  const kubeVersion = '1.20.7';
  const kubectlURL = `https://dl.k8s.io/v${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
  const kubectlPath = path.join(binDir, exeName('kubectl'));

  // If kubectlPath is a symlink delete it before continuing
  try {
    const stat = await fs.promises.lstat(kubectlPath);

    if (stat.isSymbolicLink()) {
      await fs.promises.rm(kubectlPath);
    }
  } catch (_) {}
  await download(kubectlURL, kubectlPath, false, fs.constants.X_OK);

  const helmVersion = '3.6.0';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-amd64.tar.gz`;

  await downloadTarGZ(helmURL, 'helm', `${ kubePlatform }-amd64`);

  // Download Kim
  const kimVersion = '0.1.0-beta.2';
  const kimURL = `https://github.com/rancher/kim/releases/download/v${ kimVersion }/${ exeName(`kim-${ kubePlatform }-amd64`) }`;
  const kimPath = path.join(binDir, exeName('kim'));

  await download(kimURL, kimPath, false, fs.constants.X_OK);

  const kuberlrVersion = '0.3.1';
  const kuberlrBaseURL = `https://github.com/flavio/kuberlr/releases/download/v${ kuberlrVersion }/kuberlr_${ kuberlrVersion }_${ kubePlatform }_amd64`;
  const kuberlrPlatformDir = `kuberlr_${ kuberlrVersion }_${ kubePlatform }_amd64`;
  let kuberlrPath;

  if (onWindows) {
    kuberlrPath = await downloadZip(`${ kuberlrBaseURL }.zip`, 'kuberlr', kuberlrPlatformDir);
  } else {
    kuberlrPath = await downloadTarGZ(`${ kuberlrBaseURL }.tar.gz`, 'kuberlr', kuberlrPlatformDir);
  }

  // Desired:
  // copy kubectl to ~/.kuberlr/PLATFORM-amd64/kubectlMAJ.MIN.PATCH
  // .../resources/PLATFORM/bin: symlink kubectl pointing to kuberlr
  if (kuberlrPath) {
    const kuberlrDir = path.join(getHome(), '.kuberlr', `${ kubePlatform }-amd64`);
    const pathParts = path.parse(kubectlPath);
    const newKubectlPath = path.join(kuberlrDir, `${ pathParts.name }${ kubeVersion }${ pathParts.ext }`);

    /*
     * # The following code would do this in bash:
     * if [-f $newKubectlPath] ; then
     *   rm $kubectlPath
     * else
     *   mkdir -p $(dirname $newKubectlPath)
     *   mv $kubectlPath $newKubectlPath
     * fi
     * ln -s $kuberlrPath $kubectlPath # cp on windows
     */
    try {
      await fs.promises.access(newKubectlPath);
      await fs.promises.rm(kubectlPath);
    } catch (_) {
      await fs.promises.mkdir(kuberlrDir, { recursive: true, mode: 0o755 });
      try {
        await fs.promises.rename(kubectlPath, newKubectlPath);
      } catch (_) {
        // Assume we ran into a cross-link error
        await fs.promises.copyFile(kubectlPath, newKubectlPath);
        await fs.promises.rm(kubectlPath);
      }
    }
    if (onWindows) {
      await fs.promises.copyFile(kuberlrPath, kubectlPath);
    } else {
      await fs.promises.symlink(kuberlrPath, kubectlPath);
    }
  }
}
