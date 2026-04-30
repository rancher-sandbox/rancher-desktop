/**
 * Helpers for downloading files.
 */

import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';

import { simpleSpawn } from '@/scripts/simple_process';

type ChecksumAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface DownloadOptions {
  /** Hex-encoded sha256 the downloaded bytes must match. */
  expectedChecksum?: string;
  /** Whether to re-download files that already exist. */
  overwrite?:        boolean;
  /** The file mode required. */
  access?:           number;
  /** The file needs a new ad-hoc signature. */
  codesign?:         boolean;
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
      if (ex?.errno === 'EAI_AGAIN') {
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
  const overwrite = options.overwrite ?? false;
  const access = options.access ?? fs.constants.X_OK;

  // Codesign rewrites destPath in place, so its bytes no longer match
  // the upstream digest.  Keep the verified bytes at .unsigned and
  // hash that on cache-hit checks.
  const hashTarget = options.codesign ? `${ destPath }.unsigned` : destPath;

  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      if (expectedChecksum) {
        try {
          const actualChecksum = await hashFile(hashTarget, 'sha256');

          if (actualChecksum === expectedChecksum) {
            console.log(`${ destPath } already exists with expected checksum, not re-downloading.`);

            return;
          }
          console.log(`${ destPath } exists but sha256 of ${ hashTarget } differs ([${ actualChecksum }] vs expected [${ expectedChecksum }]); re-downloading.`);
        } catch (ex: any) {
          if (ex.code !== 'ENOENT') {
            throw ex;
          }
          console.log(`${ destPath } exists but ${ hashTarget } is missing; re-downloading.`);
        }
      } else {
        console.log(`${ destPath } already exists, not re-downloading.`);

        return;
      }
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
      const actualChecksum = await hashFile(tempPath, 'sha256');

      if (actualChecksum !== expectedChecksum) {
        throw new Error(`Expecting URL ${ url } to have sha256 [${ expectedChecksum }], got [${ actualChecksum }]`);
      }
    }
    const mode =
            (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

    await fs.promises.chmod(tempPath, mode);
    if (options.codesign) {
      const unsignedPath = `${ destPath }.unsigned`;

      await fs.promises.rename(tempPath, unsignedPath);
      await fs.promises.copyFile(unsignedPath, destPath);
      await fs.promises.chmod(destPath, mode);
      const result = spawnSync(
        'codesign',
        ['--force', '--sign', '-', destPath],
        { stdio: 'inherit' },
      );

      if (result.status !== 0) {
        // Drop the unsigned cache so the next run re-downloads and re-signs;
        // otherwise the cache-hit path would hash the unsigned file and skip
        // the failed signing step forever.
        await fs.promises.rm(unsignedPath, { force: true });
        const detail = result.error ? `: ${ result.error.message }` : '';

        throw new Error(`codesign failed for ${ destPath } (exit ${ result.status })${ detail }`);
      }
    } else {
      await fs.promises.rename(tempPath, destPath);
    }
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (ex: any) {
      if (ex.code !== 'ENOENT') {
        console.error(ex);
      }
    }
  }
}

/**
 * Streams the file at `filePath` through the named hash and returns the
 * hex-encoded digest.  Read errors propagate to the caller.
 */
export async function hashFile(filePath: string, algorithm: ChecksumAlgorithm = 'sha256'): Promise<string> {
  const hash = crypto.createHash(algorithm);

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    hash.on('finish', () => resolve());
    stream.pipe(hash);
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
  const access = options.access ?? fs.constants.X_OK;
  const tgzPath = `${ destPath.replace(/\.exe$/, '') }.tar.gz`;
  const fileToExtract = options.entryName || path.basename(destPath);
  const mode =
        (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  // Persist the verified archive next to destPath; download() handles
  // the cache-hit checksum check against the manifest.  Strip codesign
  // because that runs against the extracted binary, not the archive.
  const { codesign: _codesign, ...inner } = options;

  await download(url, tgzPath, { ...inner, access: fs.constants.W_OK });

  // Re-extract on every postinstall so destPath always reflects the
  // current archive, even after a version bump that re-downloaded
  // tgzPath above.  copyFile overwrites destPath unconditionally,
  // so a postinstall run while Rancher Desktop or another shell
  // holds the binary fails with EBUSY/EPERM on Windows or ETXTBSY
  // on Linux.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ path.basename(destPath, '.exe') }-`));
  const args = ['tar', '-zxf', tgzPath, '--directory', workDir, fileToExtract];

  try {
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
  const access = options.access ?? fs.constants.X_OK;
  const zipPath = `${ destPath.replace(/\.exe$/, '') }.zip`;
  const fileToExtract = options.entryName || path.basename(destPath);
  const mode =
        (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  // Persist the verified archive next to destPath; download() handles
  // the cache-hit checksum check against the manifest.  Strip codesign
  // because that runs against the extracted binary, not the archive.
  const { codesign: _codesign, ...inner } = options;

  await download(url, zipPath, { ...inner, access: fs.constants.W_OK });

  // Re-extract on every postinstall so destPath always reflects the
  // current archive, even after a version bump that re-downloaded
  // zipPath above.  copyFileSync overwrites destPath unconditionally,
  // so a postinstall run while Rancher Desktop or another shell
  // holds the binary fails with EBUSY/EPERM on Windows or ETXTBSY
  // on Linux.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `rd-${ path.basename(destPath, '.exe') }-`));
  const args = ['unzip', '-q', '-o', zipPath, fileToExtract, '-d', workDir];

  try {
    execFileSync(args[0], args.slice(1), { stdio: 'inherit' });
    fs.copyFileSync(path.join(workDir, fileToExtract), destPath);
    fs.chmodSync(destPath, mode);
  } finally {
    fs.rmSync(workDir, { recursive: true, maxRetries: 10 });
  }

  return destPath;
}
