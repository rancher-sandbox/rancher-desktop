import childProcess from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import fetch from 'node-fetch';

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
const onWindows = kubePlatform === 'windows';

function exeName(name) {
  return `${ name }${ onWindows ? '.exe' : '' }`;
}

async function getSHAHashForFile(inputPath) {
  const hash = crypto.createHash('sha256');

  await new Promise((resolve) => {
    hash.on('finish', resolve);
    fs.createReadStream(inputPath).pipe(hash);
  });

  return hash.digest('hex');
}

/**
 * Download the given URL, making the result executable
 * @param url {string} The URL to download
 * @param destPath {string} The path to download to
 * @param expectedSHA {string} The URL's hash URL, default empty string
 * @param overwrite {boolean} Whether to re-download files that already exist.
 * @param access {number} The file mode required.
 */
export async function download(url, destPath, expectedSHA = '', overwrite = false, access = fs.constants.X_OK) {
  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return;
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
  console.log(`Downloading ${ url } to ${ destPath }...`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error downloading ${ url }: ${ response.statusText }`);
  }
  const tempPath = `${ destPath }.download`;

  try {
    const file = fs.createWriteStream(tempPath);
    const promise = new Promise(resolve => file.on('finish', resolve));

    response.body.pipe(file);
    await promise;

    if (expectedSHA) {
      const actualSHA = await getSHAHashForFile(tempPath);

      if (actualSHA !== expectedSHA) {
        throw new Error(`Expecting URL ${ url } to have SHA [${ expectedSHA }], got [${ actualSHA }]`);
      }
    }
    const mode =
    (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

    await fs.promises.chmod(tempPath, mode);
    await fs.promises.rename(tempPath, destPath);
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        console.error(ex);
      }
    }
  }
}

/**
 * Download a tar.gz file to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url {string} The URL to download.
 * @param expectedSHA {string} The URL's hash URL; empty string turns off sha checking.
 * @param binaryBasename {string} The base name of the executable to find.
 * @param platformDir {string} The platform-specific part of the path that holds the expanded executable.
 * @returns {string} The full path of the final binary if successful, '' otherwise.
 */
async function downloadTarGZ(url, expectedSHA, binaryBasename, platformDir) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  let binaryFinalPath = '';
  const fileToExtract = path.join(platformDir, exeName(binaryBasename));

  try {
    const tgzPath = path.join(workDir, `${ binaryBasename }.tar.gz`);
    const args = ['tar', '-zxvf', tgzPath, '--directory', workDir, fileToExtract];

    await download(url, tgzPath, expectedSHA, false, fs.constants.W_OK);
    if (onWindows) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      args[0] = path.join(process.env.SystemRoot, 'system32', 'tar.exe');
    }
    spawnSync(...args);
    binaryFinalPath = path.join(binDir, exeName(binaryBasename));
    fs.copyFileSync(path.join(workDir, fileToExtract), binaryFinalPath);
    fs.chmodSync(binaryFinalPath, 0o755);
  } finally {
    console.log('finishing...');
    fs.rmSync(workDir, { recursive: true, maxRetries: 10 });
  }

  return binaryFinalPath;
}

/**
 * Download a zip to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url {string} The URL to download.
 * @param expectedSHA {string} The URL's hash URL; empty string turns off sha checking.
 * @param binaryBasename {string} The base name of the executable to find.
 * @param platformDir {string} The platform-specific part of the path that holds the expanded executable.
 * @returns {string} The full path of the final binary if successful, '' otherwise.
 */
async function downloadZip(url, expectedSHA, binaryBasename, platformDir) {
  const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  let binaryFinalPath = '';
  const fileToExtract = path.join(platformDir, exeName(binaryBasename));

  try {
    const zipPath = path.join(zipDir, `${ binaryBasename }.zip`);
    const args = ['unzip', '-o', zipPath, fileToExtract, '-d', zipDir];

    await download(url, zipPath, expectedSHA, false, fs.constants.W_OK);
    spawnSync(...args);
    binaryFinalPath = path.join(binDir, exeName(binaryBasename));
    fs.copyFileSync(path.join(zipDir, fileToExtract), binaryFinalPath);
    fs.chmodSync(binaryFinalPath, 0o755);
  } finally {
    console.log('finishing...');
    fs.rmSync(zipDir, { recursive: true, maxRetries: 10 });
  }

  return binaryFinalPath;
}

export async function getResource(url) {
  return await (await fetch(url)).text();
}

/**
 * Find the home directory, in a way that is compatible with
 * kuberlr
 */
async function findHome() {
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

async function downloadKuberlr(kuberlrBaseURL, finalKuberlrSHA, kuberlrPlatformDir, onWindows) {
  if (onWindows) {
    return await downloadZip(`${ kuberlrBaseURL }.zip`, finalKuberlrSHA, 'kuberlr', kuberlrPlatformDir);
  }

  return await downloadTarGZ(`${ kuberlrBaseURL }.tar.gz`, finalKuberlrSHA, 'kuberlr', kuberlrPlatformDir);
}

export default async function main() {
  fs.mkdirSync(binDir, { recursive: true });

  const kuberlrVersion = '0.3.2';
  const kuberlrBase = `https://github.com/flavio/kuberlr/releases/download/v${ kuberlrVersion }`;
  const kuberlrBaseURL = `${ kuberlrBase }/kuberlr_${ kuberlrVersion }_${ kubePlatform }_amd64`;
  const kuberlrPlatformDir = `kuberlr_${ kuberlrVersion }_${ kubePlatform }_amd64`;
  const allKuberlrSHAs = await getResource(`${ kuberlrBase }/checksums.txt`);
  const kuberlrSHA = allKuberlrSHAs.split(/\r?\n/).filter(line => line.includes(`kuberlr_${ kuberlrVersion }_${ kubePlatform }_amd64`));

  switch (kuberlrSHA.length) {
  case 0:
    throw new Error(`Couldn't find a matching SHA for [kuberlr_${ kuberlrVersion }_${ kubePlatform }-amd64] in [${ allKuberlrSHAs }]`);
  case 1:
    break;
  default:
    throw new Error(`Matched ${ kuberlrSHA.length } hits, not exactly 1, for platform ${ kubePlatform } in [${ allKuberlrSHAs }]`);
  }
  const finalKuberlrSHA = kuberlrSHA[0].split(/\s+/, 1)[0];
  const kuberlrPath = await downloadKuberlr(kuberlrBaseURL, finalKuberlrSHA, kuberlrPlatformDir, onWindows);

  // Download Kubectl, either into the bin dir, or into kuberlr's directory of versioned kubectl's
  const kubeVersion = (await getResource('https://dl.k8s.io/release/stable.txt')).trim();
  const kubectlURL = `https://dl.k8s.io/${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
  const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
  // if there's no kuberlr, use a non-symlinked kubectl
  const binKubectlPath = path.join(binDir, exeName('kubectl'));
  let needToRelink = true;
  const kuberlrDir = path.join(await findHome(), '.kuberlr', `${ kubePlatform }-amd64`);
  const pathParts = path.parse(binKubectlPath);
  // let kuberlr manage different versions of kubectl
  const managedKubectlPath = path.join(kuberlrDir, `${ pathParts.name }${ kubeVersion.replace(/^v/, '') }${ pathParts.ext }`);

  // If kubectlPath is a symlink delete it before continuing
  // There is no kuberlr, so install a real version of kubectl in .../bin
  // If there's a symlink currently there we need to remove it or we'll overwrite kuberlr
  try {
    const binKubectlStat = await fs.promises.lstat(binKubectlPath);

    if (binKubectlStat.isSymbolicLink()) {
      if (kuberlrPath) {
        const actualTarget = await fs.promises.readlink(binKubectlPath);

        if (actualTarget === exeName('kuberlr')) {
          needToRelink = false;
        } else {
          console.log(`Deleting symlink ${ binKubectlPath } unexpectedly pointing to ${ actualTarget }`);
          await fs.promises.rm(binKubectlPath);
        }
      } else {
        // Always delete it -- we're moving to a world where this is never a symbolic link
        await fs.promises.rm(binKubectlPath);
        needToRelink = false;
      }
    }
  } catch (_) {
  }

  if (kuberlrPath) {
    await download(kubectlURL, managedKubectlPath, kubectlSHA);
    if (needToRelink) {
      if (onWindows) {
        await fs.promises.copyFile(kuberlrPath, binKubectlPath);
      } else {
        const currentDir = process.cwd();

        process.chdir(binDir);
        try {
          await fs.promises.symlink(exeName('kuberlr'), exeName('kubectl'));
        } finally {
          process.chdir(currentDir);
        }
      }
    }
  } else {
    await download(kubectlURL, binKubectlPath, kubectlSHA);
  }

  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const helmVersion = '3.6.1';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-amd64.tar.gz`;
  const helmSHA = (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0];

  await downloadTarGZ(helmURL, helmSHA, 'helm', `${ kubePlatform }-amd64`);

  // Download Kim
  const kimVersion = '0.1.0-beta.2';
  const kimURLBase = `https://github.com/rancher/kim/releases/download/v${ kimVersion }`;
  const kimURL = `${ kimURLBase }/${ exeName(`kim-${ kubePlatform }-amd64`) }`;
  const kimPath = path.join(binDir, exeName( 'kim'));
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
  await download(kimURL, kimPath, kimSHA[0].split(/\s+/, 1)[0]);
}
