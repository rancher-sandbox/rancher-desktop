/**
 * Helpers for downloading files.
 */

import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';

import { simpleSpawn } from 'scripts/simple_process';

type ChecksumAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface DownloadOptions {
  expectedChecksum?:  string;
  checksumAlgorithm?: ChecksumAlgorithm;
  // Whether to re-download files that already exist.
  overwrite?:         boolean;
  // The file mode required.
  access?:            number;
  // The file needs a new ad-hoc signature.
  codesign?:          boolean;
}

export type ArchiveDownloadOptions = DownloadOptions & {
  // The name in the archive of the file; defaults to base name of the destination.
  entryName?: string;
};

async function fetchWithRetry(url: string) {
  while (true) {
    try {
      return await fetch(url, { redirect: 'follow' });
    } catch (ex: any) {
      if (ex && ex.errno === 'EAI_AGAIN') {
        console.log(`Recoverable error downloading ${ url }, retrying...`);
        continue;
      }
      console.dir(ex);
      throw ex;
    }
  }
}

function checkDownloadStatusOrThrow(url: string, response: Response): void {
  if (!response.ok) {
    const requestId = response.headers.get('x-github-request-id');
    const requestAnnotation = requestId ? ` [request: ${ requestId }]` : '';
    throw new Error(`Error downloading ${ url } (${ response.status }) ${ response.statusText }${ requestAnnotation }`);
  }
}

/**
 * Download the given URL, making the result executable.
 * @param url The URL to download
 * @param destPath The path to download to
 * @param options Additional options for the download.
 */
export async function download(url: string, destPath: string, options: DownloadOptions = {}): Promise<void> {
  const expectedChecksum = options.expectedChecksum;
  const checksumAlgorithm = options.checksumAlgorithm ?? 'sha256';
  const overwrite = options.overwrite ?? false;
  const access = options.access ?? fs.constants.X_OK;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return;
    } catch (ex: any) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
  console.log(`Downloading ${ url } to ${ destPath }...`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const response = await fetchWithRetry(url);

  checkDownloadStatusOrThrow(url, response);
  if (!response.body) {
    throw new Error(`Error downloading ${ url }: did not receive response body`);
  }
  const tempPath = `${ destPath }.download`;

  try {
    const file = fs.createWriteStream(tempPath);

    await response.body.pipeTo(stream.Writable.toWeb(file));

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
    } catch (ex: any) {
      if (ex.code !== 'ENOENT') {
        console.error(ex);
      }
    }
  }

  if (options.codesign) {
    spawnSync(
      'codesign',
      ['--force', '--sign', '-', destPath],
      { stdio: 'inherit' },
    );
  }
}

/**
 * Compute the checksum for a given file
 * @param inputPath The file to checksum.
 * @param checksumAlgorithm The checksum algorithm to use.
 * @returns The hex-encoded checksum of the file.
 */
async function getChecksumForFile(inputPath: string, checksumAlgorithm: ChecksumAlgorithm = 'sha256'): Promise<string> {
  const hash = crypto.createHash(checksumAlgorithm);

  await new Promise((resolve) => {
    hash.on('finish', resolve);
    fs.createReadStream(inputPath).pipe(hash);
  });

  return hash.digest('hex');
}

/**
 * Return the contents of a given URL.
 * @param url The URL to download
 * @returns The file contents.
 */
export async function getResource(url: string): Promise<string> {
  const response = await fetchWithRetry(url);

  checkDownloadStatusOrThrow(url, response);

  return await response.text();
}

/**
 * Download a tar.gz file to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url The URL to download.
 * @param destPath The path to download to, including the executable name.
 * @param options Additional options for the download.
 * @returns The full path of the final binary.
 */
export async function downloadTarGZ(url: string, destPath: string, options: ArchiveDownloadOptions = {}): Promise<string> {
  const overwrite = options.overwrite ?? false;
  const access = options.access ?? fs.constants.X_OK;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return destPath;
    } catch (ex: any) {
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
    const args = ['tar', '-zxf', tgzPath, '--directory', workDir, fileToExtract];
    const mode =
            (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

    await download(url, tgzPath, { ...options, access: fs.constants.W_OK });
    if (os.platform().startsWith('win')) {
      // On Windows, force use the bundled bsdtar.
      // We may find GNU tar on the path, which looks at the Windows-style path
      // and considers C:\Temp to be a reference to a remote host named `C`.
      const systemRoot = process.env.SystemRoot;

      if (!systemRoot) {
        throw new Error('Could not find system root');
      }
      args[0] = path.join(systemRoot, 'system32', 'tar.exe');
    }
    await simpleSpawn(args[0], args.slice(1));
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(path.join(workDir, fileToExtract), destPath);
    await fs.promises.chmod(destPath, mode);
  } finally {
    fs.rmSync(workDir, { recursive: true, maxRetries: 10 });
  }

  return destPath;
}

/**
 * Download a zip file to a temp dir, expand,
 * and move the expected binary to the final dir
 *
 * @param url The URL to download.
 * @param destPath The path to download to, including the executable name.
 * @param options Additional options for the download.
 * @returns The full path of the final binary.
 */
export async function downloadZip(url: string, destPath: string, options: ArchiveDownloadOptions = {}): Promise<string> {
  const overwrite = options.overwrite ?? false;
  const access = options.access ?? fs.constants.X_OK;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return destPath;
    } catch (ex: any) {
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
    const zipPath = path.join(workDir, `${ binaryBasename }.zip`);
    const args = ['unzip', '-q', '-o', zipPath, fileToExtract, '-d', workDir];

    await download(url, zipPath, { ...options, access: fs.constants.W_OK });
    execFileSync(args[0], args.slice(1), { stdio: 'inherit' });
    fs.copyFileSync(path.join(workDir, fileToExtract), destPath);
    fs.chmodSync(destPath, mode);
  } finally {
    fs.rmSync(workDir, { recursive: true, maxRetries: 10 });
  }

  return destPath;
}
