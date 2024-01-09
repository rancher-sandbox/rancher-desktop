/**
 * This script signs existing builds.
 *
 * Usage: yarn sign -- blahblah.zip
 *
 * Currently, only Windows is supported; mac support is planned.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import extract from 'extract-zip';

import * as macos from './lib/sign-macos';
import * as windows from './lib/sign-win32';

async function signArchive(archive: string): Promise<void> {
  const distDir = path.join(process.cwd(), 'dist');

  await fs.promises.mkdir(distDir, { recursive: true });
  const workDir = await fs.promises.mkdtemp(path.join(distDir, 'sign-'));
  const archiveDir = path.join(workDir, 'unpacked');
  let artifacts: string[] | undefined;

  try {
    // Extract the archive
    console.log(`Extracting ${ archive } to ${ archiveDir }...`);
    await fs.promises.mkdir(archiveDir, { recursive: true });
    await extract(archive, { dir: archiveDir });

    // Detect the archive type
    for (const file of await fs.promises.readdir(archiveDir)) {
      if (file.endsWith('.exe')) {
        artifacts = await windows.sign(workDir);
        break;
      }
      if (file.endsWith('.app')) {
        artifacts = await macos.sign(workDir);
        break;
      }
    }

    if (!artifacts) {
      throw new Error(`Could not find any files to sign in ${ archive }`);
    }
    await Promise.all(artifacts.map(f => computeChecksum(f)));

    for (const line of ['Signed results:', ...artifacts.map(f => ` - ${ f }`)]) {
      console.log(line);
    }
  } finally {
    await fs.promises.rm(workDir, { recursive: true, maxRetries: 3 });
  }
}

async function computeChecksum(artifact: string) {
  const hash = crypto.createHash('sha512');
  const reader = fs.createReadStream(artifact);

  await new Promise((resolve, reject) => {
    hash.on('finish', resolve);
    hash.on('error', reject);
    reader.pipe(hash);
  });
  await fs.promises.writeFile(
    `${ artifact }.sha512sum`,
    `${ hash.digest('hex') } *${ path.basename(artifact) }`);
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
