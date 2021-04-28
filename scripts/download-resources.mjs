import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';
import fetch from 'node-fetch';

const chmod = util.promisify(fs.chmod);

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

/**
 * Download the given URL, making the result executable
 * @param url {string} The URL to download
 * @param path {string} The path to download to
 */
async function download(url, path) {
  console.log(`Downloading ${ url } to ${ path }...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error downloading ${ url }: ${ response.statusText }`);
  }
  const file = fs.createWriteStream(path);
  const promise = new Promise(resolve => file.on('finish', resolve));

  response.body.pipe(file);
  await promise;
  await chmod(path, 0o755);
}

export default async function main() {
  const resourcesDir = path.join(process.cwd(), 'resources', os.platform());
  const binDir = path.join(resourcesDir, 'bin');
  /** The platform string, as used by golang / Kubernetes. */
  const kubePlatform = {
    darwin: 'darwin',
    win32:  'windows',
  }[os.platform()];

  fs.mkdirSync(binDir, { recursive: true });

  // Download Kubectl
  const kubeVersion = '1.20.2';
  const kubectlURL = `https://storage.googleapis.com/kubernetes-release/release/v${ kubeVersion }/bin/${ kubePlatform }/amd64/${ exeName('kubectl') }`;
  const kubectlPath = path.join(binDir, exeName('kubectl'));

  await download(kubectlURL, kubectlPath);

  // Download Helm. It is a tar.gz file that needs to be expanded and file moved.
  const helmVersion = '3.5.2';
  const helmURL = `https://get.helm.sh/helm-v${ helmVersion }-${ kubePlatform }-amd64.tar.gz`;
  const helmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-helm-'));

  try {
    const helmPath = path.join(helmDir, 'helm.tar.gz');
    const helmFinalPath = path.join(binDir, exeName('helm'));

    await download(helmURL, helmPath);
    spawnSync('tar', '-zxvf', helmPath, '--directory', helmDir);
    fs.copyFileSync(path.join(helmDir, `${ kubePlatform }-amd64`, exeName('helm')), helmFinalPath);
    fs.chmodSync(helmFinalPath, 0o755);
  } finally {
    fs.rmSync(helmDir, { recursive: true, maxRetries: 10 });
  }

  // Download Kim
  const kimVersion = '0.1.0-alpha.10';
  const kimURL = `https://github.com/rancher/kim/releases/download/v${ kimVersion }/${ exeName(`kim-${ kubePlatform }-amd64`) }`;
  const kimPath = path.join(binDir, exeName('kim'));

  await download(kimURL, kimPath);
}
