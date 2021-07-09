// WSL-related downloads for rancher-desktop development.
// Note that this does _not_ include installing WSL on the machine.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { download } from '../download-resources.mjs';

export default async function main() {
  await download(
    'https://github.com/jandubois/tinyk3s/releases/download/v0.1/distro.tar',
    path.resolve(process.cwd(), 'resources', os.platform(), 'distro-0.1.tar'),
    { access: fs.constants.F_OK });
}
