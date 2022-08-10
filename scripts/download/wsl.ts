// WSL-related downloads for rancher-desktop development.
// Note that this does _not_ include installing WSL on the machine.

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { download } from '../lib/download';

export default async function main(): Promise<void> {
  const v = '0.25';

  await download(
    `https://github.com/rancher-sandbox/rancher-desktop-wsl-distro/releases/download/v${ v }/distro-${ v }.tar`,
    path.resolve(process.cwd(), 'resources', os.platform(), `distro-${ v }.tar`),
    { access: fs.constants.W_OK });

  // Download host-resolver
  // TODO(@Nino-k) once host-resolver stabilizes remove and add to wsl-distro
  downloadHostResolver();
}

function extract(resourcesPath: string, file: string, expectedFile: string): void {
  const systemRoot = process.env.SystemRoot;

  if (!systemRoot) {
    throw new Error('Could not find system root');
  }
  const bsdTar = path.join(systemRoot, 'system32', 'tar.exe');

  spawnSync(
    bsdTar,
    ['-xzf', file, expectedFile],
    {
      cwd:   resourcesPath,
      stdio: 'inherit'
    });
  fs.rmSync(file, { maxRetries: 10 });
}

async function downloadHostResolver(): Promise<void> {
  const hv = 'v0.1.0-beta.1';
  const baseURL = 'https://github.com/rancher-sandbox/rancher-desktop-host-resolver/releases/download';

  // download peer for linux
  const resolverVsockPeerURL = `${ baseURL }/${ hv }/host-resolver-${ hv }-linux-amd64.tar.gz`;
  const linuxPath = path.resolve(process.cwd(), 'resources', 'linux', 'internal');
  const resolverVsockPeerPath = path.join(linuxPath, `host-resolver-${ hv }-linux-amd64.tar.gz`);

  await download(
    resolverVsockPeerURL,
    resolverVsockPeerPath,
    { access: fs.constants.W_OK });

  extract(linuxPath, resolverVsockPeerPath, 'host-resolver');

  // download host for windows
  const resolverVsockHostURL = `${ baseURL }/${ hv }/host-resolver-${ hv }-windows-amd64.zip`;
  const win32Path = path.resolve(process.cwd(), 'resources', os.platform(), 'internal');
  const resolverVsockHostPath = path.join(win32Path, `host-resolver-${ hv }-windows-amd64.zip`);

  await download(
    resolverVsockHostURL,
    resolverVsockHostPath,
    { access: fs.constants.W_OK });

  extract(win32Path, resolverVsockHostPath, 'host-resolver.exe');
}
