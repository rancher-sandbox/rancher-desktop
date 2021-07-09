// This downloads the macOS resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { download, getResource } from './download-resources.mjs';

const limaRepo = 'https://github.com/rancher-sandbox/lima';
const limaTag = 'v0.5.0';

const alpineLimaRepo = 'https://github.com/rancher-sandbox/alpine-lima';
const alpineLimaTag = 'v0.0.1';
const alpineLimaEdition = 'ci';
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
  const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpline-lima-${ alpineLimaTag }-${ alpineLimaEdition }-${ alpineLimaVersion }.iso`);
  const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];

  await download(url, destPath, {
    expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK
  });
}

async function getK3sHelpers() {
  await download(
    'https://github.com/jandubois/tinyk3s/raw/v0.1/run-k3s',
    path.resolve(process.cwd(), 'resources', os.platform(), 'run-k3s'));
}

export default function run() {
  return Promise.all([getLima(), getAlpineLima(), getK3sHelpers()]);
}
