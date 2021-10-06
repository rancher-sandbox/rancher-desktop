// This downloads the macOS resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { download, getResource } from '../lib/download.mjs';

const limaRepo = 'https://github.com/rancher-sandbox/lima-and-qemu';
const limaTag = 'v1.7';

const limaLinuxRepo = 'https://github.com/lima-vm/lima';
const limaLinuxVersion = '0.6.4';

const alpineLimaRepo = 'https://github.com/lima-vm/alpine-lima';
const alpineLimaTag = 'v0.1.8';
const alpineLimaEdition = 'rd';
const alpineLimaVersion = '3.13.5';

async function getLima() {
  const url = `${ limaRepo }/releases/download/${ limaTag }/lima-and-qemu.tar.gz`;
  const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];
  const resourcesDir = path.join(process.cwd(), 'resources', os.platform());
  const limaDir = path.join(resourcesDir, 'lima');
  const tarPath = path.join(resourcesDir, `lima-${ limaTag }.tgz`);

  await download(url, tarPath, {
    expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK
  });
  await fs.promises.mkdir(limaDir, { recursive: true });

  const child = childProcess.spawn('/usr/bin/tar', ['-xf', tarPath],
    { cwd: limaDir, stdio: 'inherit' });

  await new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Lima extract failed with ${ code || signal }`));
      }
    });
  });
}

async function getAlpineLima() {
  const url = `${ alpineLimaRepo }/releases/download/${ alpineLimaTag }/alpine-lima-${ alpineLimaEdition }-${ alpineLimaVersion }-x86_64.iso`;
  const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpine-lima-${ alpineLimaTag }-${ alpineLimaEdition }-${ alpineLimaVersion }.iso`);
  const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];

  await download(url, destPath, {
    expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK
  });
}

async function getLinuxLima() {
  const baseUrl = `${ limaLinuxRepo }/releases/download/v${ limaLinuxVersion }`;
  const url = `${ baseUrl }/lima-${ limaLinuxVersion }-Linux-x86_64.tar.gz`;
  const expectedChecksum = (await getResource(`${ baseUrl }/SHA256SUMS`)).split(/\r?\n/)[3].split(/\s+/)[0];
  const resourcesDir = path.join(process.cwd(), 'resources', os.platform());
  const limaDir = path.join(resourcesDir, 'lima');
  const tarPath = path.join(resourcesDir, `lima-${ limaLinuxVersion }.tar.gz`);

  await download(url, tarPath, {
    expectedChecksum, checksumAlgorithm: 'sha256', access: fs.constants.W_OK
  });
  await fs.promises.mkdir(limaDir, { recursive: true });

  const child = childProcess.spawn('/usr/bin/tar', ['-xf', tarPath],
    { cwd: limaDir, stdio: 'inherit' });

  await new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Lima extract failed with ${ code || signal }`));
      }
    });
  });
}

export default function run() {
  if (os.platform().startsWith('linux')) {
    return Promise.all([getLinuxLima(), getAlpineLima()]);
  }
  if (os.platform().startsWith('darwin')) {
    return Promise.all([getLima(), getAlpineLima()]);
  }
}
