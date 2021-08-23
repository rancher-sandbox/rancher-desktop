// WSL-related downloads for rancher-desktop development.
// Note that this does _not_ include installing WSL on the machine.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { download } from '../lib/download.mjs';

export default async function main() {
  await download(
    'https://github.com/rancher-sandbox/rancher-desktop-wsl-distro/releases/download/v0.2/distro-0.2.tar',
    path.resolve(process.cwd(), 'resources', os.platform(), 'distro-0.2.tar'),
    { access: fs.constants.W_OK });
}
