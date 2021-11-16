/**
 * Helpers for downloading files.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import fetch from 'node-fetch';

/**
 * @typedef DownloadOptions Object
 * @prop {string} [expectedChecksum] The expected checksum for the file.
 * @prop {string} [checksumAlgorithm="sha256"] Checksum algorithm.
 * @prop {boolean} [overwrite=false] Whether to re-download files that already exist.
 * @prop {number} [access=fs.constants.X_OK] The file mode required.
 */

/**
 * Download the given URL, making the result executable
 * @param {string} [url] The URL to download
 * @param {string} [destPath] The path to download to
 * @param {DownloadOptions} [options] Additional options for the download.
 * @returns {Promise<void>}
 */
export async function download(url, destPath, options = {}) {
  const { expectedChecksum, overwrite } = options;
  const checksumAlgorithm = options.checksumAlgorithm ?? 'sha256';
  const access = options.access ?? fs.constants.X_OK;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return;
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
  console.log(`Downloading ${ url } to ${ destPath }...`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error downloading ${ url }: ${ response.statusText }`);
  }
  const tempPath = `${ destPath }.download`;

  try {
    const file = fs.createWriteStream(tempPath);
    const promise = new Promise(resolve => file.on('finish', resolve));

    response.body.pipe(file);
    await promise;

    if (expectedChecksum) {
      const actualChecksum = await getChecksumForFile(tempPath, checksumAlgorithm);

      if (actualChecksum !== expectedChecksum) {
        throw new Error(`Expecting URL ${ url } to have ${ checksumAlgorithm } [${ expectedChecksum }], got [${ actualChecksum }]`);
      }
    }
    const mode =
            (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

    await fs.promises.chmod(tempPath, mode);
    await fs.promises.rename(tempPath, destPath);
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        console.error(ex);
      }
    }
  }
}

/**
 * Compute the checksum for a given file
 * @param {string} inputPath The file to checksum.
 * @param {'sha256' | 'sha1'} checksumAlgorithm The checksum algorithm to use.
 * @returns {string} The hex-encoded checksum of the file.
 */
async function getChecksumForFile(inputPath, checksumAlgorithm = 'sha256') {
  const hash = crypto.createHash(checksumAlgorithm);

  await new Promise((resolve) => {
    hash.on('finish', resolve);
    fs.createReadStream(inputPath).pipe(hash);
  });

  return hash.digest('hex');
}

/**
 * Return the contents of a given URL.
 * @param {string} url The URL to download
 * @returns {string} The file contents.
 */
export async function getResource(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error downloading ${ url }`, response.statusText);
  }

  return await response.text();
}

/**
 * @typedef ArchiveDownloadOptions DownloadOptions
 * @prop {string} [entryName] The name in the archive of the file; defaults to base name of the destination.
 */

/**
 * Download a tar.gz file to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url {string} The URL to download.
 * @param destPath {string} The path to download to, including the executable name.
 * @param options {ArchiveDownloadOptions} Additional options for the download.
 * @returns {Promise<string>} The full path of the final binary.
 */
export async function downloadTarGZ(url, destPath, options = {}) {
  const { overwrite } = options;
  const access = options.access ?? fs.constants.X_OK;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return destPath;
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
  const binaryBasename = path.basename(destPath, '.exe');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  const fileToExtract = options.entryName || path.basename(destPath);

  try {
    const tgzPath = path.join(workDir, `${ binaryBasename }.tar.gz`);
    const args = ['tar', '-zxvf', tgzPath, '--directory', workDir, fileToExtract];
    const mode =
            (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

    await download(url, tgzPath, { ...options, access: fs.constants.W_OK });
    if (os.platform().startsWith('win')) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      args[0] = path.join(process.env.SystemRoot, 'system32', 'tar.exe');
    }
    spawnSync(args[0], args.slice(1), { stdio: 'inherit' });
    fs.copyFileSync(path.join(workDir, fileToExtract), destPath);
    fs.chmodSync(destPath, mode);
  } finally {
    fs.rmSync(workDir, { recursive: true, maxRetries: 10 });
  }

  return destPath;
}

/**
 * Download a zip file to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url {string} The URL to download.
 * @param destPath {string} The path to download to, including the executable name.
 * @param options {ArchiveDownloadOptions} Additional options for the download.
 * @returns {Promise<string>} The full path of the final binary.
 */
export async function downloadZip(url, destPath, options = {}) {
  const { overwrite } = options;
  const access = options.access ?? fs.constants.X_OK;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return destPath;
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
  const binaryBasename = path.basename(destPath, '.exe');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ binaryBasename }-`));
  const fileToExtract = options.entryName || path.basename(destPath);
  const mode =
        (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

  try {
    const zipPath = path.join(workDir, `${ binaryBasename }.tar.gz`);
    const args = ['unzip', '-o', zipPath, fileToExtract, '-d', workDir];

    await download(url, zipPath, { ...options, access: fs.constants.W_OK });
    spawnSync(args[0], args.slice(1), { stdio: 'inherit' });
    fs.copyFileSync(path.join(workDir, fileToExtract), destPath);
    fs.chmodSync(destPath, mode);
  } finally {
    fs.rmSync(workDir, { recursive: true, maxRetries: 10 });
  }

  return destPath;
}
