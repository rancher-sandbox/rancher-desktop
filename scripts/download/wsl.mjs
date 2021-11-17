// WSL-related downloads for rancher-desktop development.
// Note that this does _not_ include installing WSL on the machine.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { download } from '../lib/download.mjs';

export default async function main() {
  const v = '0.8';

  await download(
    `https://github.com/rancher-sandbox/rancher-desktop-wsl-distro/releases/download/v${ v }/distro-${ v }.tar`,
    path.resolve(process.cwd(), 'resources', os.platform(), `distro-${ v }.tar`),
    { access: fs.constants.W_OK });
}
