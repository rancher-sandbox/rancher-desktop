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

export async function getResource(url) {
  return await (await fetch(url)).text();
}

// Download a tar.gz file to a temp dir, expand,
// and move the expected binary to the final dir
async function downloadTarGZ(url, binaryBasename, tgzPlatformDir) {
  const tgzDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
/**
 * Download a tar.gz file to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url {string} The URL to download.
 * @param binaryBasename {string} The base name of the executable to find.
 * @param platformDir {string} The platform-specific part of the path that holds the expanded executable.
 * @returns {string} The full path of the final binary if successful, '' otherwise.
 */
async function downloadTarGZ(url, binaryBasename, platformDir) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  let binaryFinalPath = '';

  try {
    const tgzPath = path.join(workDir, `${ binaryBasename }.tar.gz`);
    const args = ['tar', '-zxvf', tgzPath, '--directory', workDir];

    await download(url, tgzPath, false, fs.constants.W_OK);
    if (onWindows) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      args[0] = path.join(process.env.SystemRoot, 'system32', 'tar.exe');
    }
    spawnSync(...args);
    binaryFinalPath = path.join(binDir, exeName(binaryBasename));
    fs.copyFileSync(path.join(workDir, platformDir, exeName(binaryBasename)), binaryFinalPath);
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
 * @param binaryBasename {string} The base name of the executable to find.
 * @param platformDir {string} The platform-specific part of the path that holds the expanded executable.
 * @returns {string} The full path of the final binary if successful, '' otherwise.
 */
async function downloadZip(url, binaryBasename, platformDir) {
  const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  let binaryFinalPath = '';

  try {
    const zipPath = path.join(zipDir, `${ binaryBasename }.zip`);
    const args = ['unzip', '-o', zipPath, '-d', zipDir];

    await download(url, zipPath, false, fs.constants.W_OK);
    spawnSync(...args);
    binaryFinalPath = path.join(binDir, exeName(binaryBasename));
    fs.copyFileSync(path.join(zipDir, platformDir, exeName(binaryBasename)), binaryFinalPath);
    fs.chmodSync(binaryFinalPath, 0o755);
  } finally {
    console.log('finishing...');
    fs.rmSync(zipDir, { recursive: true, maxRetries: 10 });
  }

  return binaryFinalPath;
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

export default async function main() {
  // Download Kubectl
  const kubeVersion = (await (await fetch('https://dl.k8s.io/release/stable.txt')).text()).trim();
  const kubectlURL = `https://dl.k8s.io/${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
  const kubectlPath = path.join(binDir, exeName('kubectl'));

  const kubeVersion = '1.20.7';
  const kubectlURL = `https://dl.k8s.io/v${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
  const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
  const kubectlPath = path.join(binDir, exeName('kubectl'));


  fs.mkdirSync(binDir, { recursive: true });
  // If kubectlPath is a symlink delete it before continuing
  try {
    const stat = await fs.promises.lstat(kubectlPath);

    if (stat.isSymbolicLink()) {
      await fs.promises.rm(kubectlPath);
    }
  } catch (_) {}
  await download(kubectlURL, kubectlPath, false, fs.constants.X_OK);
  await download(kubectlURL, kubectlPath, kubectlSHA);

  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const helmVersion = '3.6.1';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-amd64.tar.gz`;
  const helmSHA = (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0];
  const helmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-helm-'));

  await downloadTarGZ(helmURL, 'helm', `${ kubePlatform }-amd64`);

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
    const kuberlrDir = path.join(await findHome(), '.kuberlr', `${ kubePlatform }-amd64`);
    const pathParts = path.parse(kubectlPath);
    const newKubectlPath = path.join(kuberlrDir, `${ pathParts.name }${ kubeVersion.replace(/^v/, '') }${ pathParts.ext }`);

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
