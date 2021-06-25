// This downloads the macOS resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { download, getResource } from './download-resources.mjs';

const limaRepo = 'https://github.com/rancher-sandbox/lima';
const limaTag = 'rd-v0.1.0';
// TODO: Get this from GitHub instead.

export default async function run() {
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
