/**
 * This script signs existing builds.
 *
 * Usage: yarn sign -- blahblah.zip
 *
 * Currently, only Windows is supported; mac support is planned.
 */

import fs from 'fs';
import path from 'path';

import extract from 'extract-zip';

import * as windows from './lib/sign-win32';

async function signArchive(archive: string) {
  const distDir = path.join(process.cwd(), 'dist');

  await fs.promises.mkdir(distDir, { recursive: true });
  const workDir = await fs.promises.mkdtemp(path.join(distDir, 'sign-'));
  const archiveDir = path.join(workDir, 'unpacked');

  try {
    // Extract the archive
    console.log(`Extracting ${ archive } to ${ archiveDir }...`);
    await fs.promises.mkdir(archiveDir, { recursive: true });
    await extract(archive, { dir: archiveDir });

    // Detect the archive type
    for (const file of await fs.promises.readdir(archiveDir)) {
      if (file.endsWith('.exe')) {
        return await windows.sign(workDir);
      }
    }
  } finally {
    await fs.promises.rm(workDir, { recursive: true, maxRetries: 3 });
  }
}

(async() => {
  try {
    let fileCount = 0;

    for (const path of process.argv) {
      if (path.endsWith('.zip')) {
        fileCount++;
        await signArchive(path);
      }
    }
    if (fileCount < 1) {
      throw new Error('No files provided to sign!');
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
