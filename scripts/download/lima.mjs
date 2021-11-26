// This downloads the macOS resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { download, getResource } from '../lib/download.mjs';

const limaRepo = 'https://github.com/rancher-sandbox/lima-and-qemu';
const limaTag = 'v1.12';

const alpineLimaRepo = 'https://github.com/lima-vm/alpine-lima';
const alpineLimaTag = 'v0.2.2';
const alpineLimaEdition = 'rd';
const alpineLimaVersion = '3.14.3';

async function getLima(platform) {
  const url = `${ limaRepo }/releases/download/${ limaTag }/lima-and-qemu.${ platform }.tar.gz`;
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

async function getAlpineLima(arch) {
  const url = `${ alpineLimaRepo }/releases/download/${ alpineLimaTag }/alpine-lima-${ alpineLimaEdition }-${ alpineLimaVersion }-${ arch }.iso`;
  const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpine-lima-${ alpineLimaTag }-${ alpineLimaEdition }-${ alpineLimaVersion }.iso`);
  const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];

  await download(url, destPath, {
    expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK
  });
}

export default function run() {
  let platform = os.platform();
  let arch = 'x86_64';

  if (platform === 'darwin') {
    platform = 'macos';
    if (process.env.M1) {
      arch = 'aarch64';
      platform = `macos-${ arch }`;
    }
  }

  return Promise.all([getLima(platform), getAlpineLima(arch)]);
}
