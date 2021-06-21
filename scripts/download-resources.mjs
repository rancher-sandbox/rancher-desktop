import childProcess from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import fetch from 'node-fetch';

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

export default async function main() {
  const resourcesDir = path.join(process.cwd(), 'resources', os.platform());
  const binDir = path.join(resourcesDir, 'bin');
  /** The platform string, as used by golang / Kubernetes. */
  const kubePlatform = {
    darwin: 'darwin',
    linux:  'linux',
    win32:  'windows',
  }[os.platform()];

  fs.mkdirSync(binDir, { recursive: true });

  // Download Kubectl
  const kubeVersion = '1.20.7';
  const kubectlURL = `https://dl.k8s.io/v${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
  const kubectlSHA = await getResource(`${ kubectlURL }.sha256`);
  const kubectlPath = path.join(binDir, exeName('kubectl'));

  await download(kubectlURL, kubectlPath, kubectlSHA);

  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const helmVersion = '3.6.1';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-amd64.tar.gz`;
  const helmSHA = (await getResource(`${ helmURL }.sha256sum`)).split(/\s+/, 1)[0];
  const helmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-helm-'));

  try {
    const helmPath = path.join(helmDir, 'helm.tar.gz');
    const helmFinalPath = path.join(binDir, exeName('helm'));
    const args = ['tar', '-zxvf', helmPath, '--directory', helmDir];

    await download(helmURL, helmPath, helmSHA);
    if (os.platform().startsWith('win')) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      args[0] = path.join(process.env.SystemRoot, 'system32', 'tar.exe');
    }
    spawnSync(...args);
    fs.copyFileSync(path.join(helmDir, `${ kubePlatform }-amd64`, exeName('helm')), helmFinalPath);
    fs.chmodSync(helmFinalPath, 0o755);
  } finally {
    fs.rmSync(helmDir, { recursive: true, maxRetries: 10 });
  }

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
