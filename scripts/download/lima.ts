// This downloads the resources related to Lima.

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { download, getResource } from '../lib/download';
import { DownloadContext } from 'scripts/lib/dependencies';

export async function downloadLimaAndQemu(context: DownloadContext, version: string): Promise<void> {
  const baseUrl = 'https://github.com/rancher-sandbox/lima-and-qemu/releases/download';
  let platform: string = context.platform;
  if (platform === 'darwin') {
    platform = 'macos';
    if (process.env.M1) {
      platform = `macos-aarch64`;
    }
  }
  const url = `${ baseUrl }/${ version }/lima-and-qemu.${ platform }.tar.gz`;
  const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];
  const limaDir = path.join(context.resourcesDir, 'lima');
  const tarPath = path.join(context.resourcesDir, `lima-${ version }.tgz`);

  await download(baseUrl, tarPath, {
    expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK,
  });
  await fs.promises.mkdir(limaDir, { recursive: true });

  const child = childProcess.spawn('/usr/bin/tar', ['-xf', tarPath],
    { cwd: limaDir, stdio: 'inherit' });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Lima extract failed with ${ code || signal }`));
      }
    });
  });
}

export async function downloadAlpineLimaISO(context: DownloadContext, version: { tag: string, version: string }): Promise<void> {
  const baseUrl = 'https://github.com/lima-vm/alpine-lima/releases/download';
  const edition = 'rd';
  let arch = 'x86_64';
  if (context.platform === 'darwin' && process.env.M1) {
    arch = 'aarch64';
  }
  const isoName = `alpine-lima-${ edition }-${ version.version }-${ arch }.iso`;
  const url = `${baseUrl}/${ version.tag }/${ isoName }`;
  const destPath = path.join(process.cwd(), 'resources', os.platform(), `alpine-lima-${ version.tag }-${ edition }-${ version.version }.iso`);
  const expectedChecksum = (await getResource(`${ url }.sha512sum`)).split(/\s+/)[0];

  await download(url, destPath, {
    expectedChecksum, checksumAlgorithm: 'sha512', access: fs.constants.W_OK,
  });
}
