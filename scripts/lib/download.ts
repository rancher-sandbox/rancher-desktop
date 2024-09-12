/**
 * Helpers for downloading files.
 */

import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import timers from 'timers/promises';

import { simpleSpawn } from 'scripts/simple_process';

type ChecksumAlgorithm = 'sha1' | 'sha256' | 'sha512';

export type DownloadOptions = {
  expectedChecksum?: string;
  checksumAlgorithm?: ChecksumAlgorithm;
  // Whether to re-download files that already exist.
  overwrite?: boolean;
  // The file mode required.
  access?: number;
  // The file needs a new ad-hoc signature.
  codesign?: boolean;
};

export type ArchiveDownloadOptions = DownloadOptions & {
  // The name in the archive of the file; defaults to base name of the destination.
  entryName?: string;
};

/**
 * GrowingWritable is an implementation of stream.Writable that just buffers
 * everything in memory.
 */
class GrowingWritable extends stream.Writable {
  protected name: string;
  protected buffer = Buffer.alloc(0);
  constructor(name: string) {
    super();
    this.name = name;
  }

  _writev(chunks: Array<{ chunk: Buffer; encoding: BufferEncoding | 'buffer'; }>, callback: (error?: Error | null) => void): void {
    // Check that all chunks have 'buffer' encoding.
    const unexpectedEncoding = chunks.map(({ encoding }) => encoding).find(e => e !== 'buffer');

    if (unexpectedEncoding) {
      console.log(`${ this.name }: failed to buffer to memory: ${ unexpectedEncoding }`);
      callback(new Error(`Only buffer chunks are accepted, not string with encoding ${ unexpectedEncoding }`));

      return;
    }
    // Copy the buffer to avoid it being lost.
    try {
      this.buffer = Buffer.concat([this.buffer, ...chunks.map(({ chunk }) => chunk)]);
    } catch (ex: any) {
      callback(ex);

      return;
    }
    callback(null);
  }

  get text() {
    return this.buffer.toString('utf-8');
  }
}

async function fetchWithRetry(url: string): Promise<string>;
async function fetchWithRetry(url: string, writable: fs.WriteStream): Promise<void>;
async function fetchWithRetry(url: string, writable?: fs.WriteStream): Promise<string | void> {
  while (true) {
    try {
      const response = await fetch(url, { redirect: 'follow' });

      if (!response.ok) {
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          // For these responses, retry the download.
          await timers.setTimeout(1_000);
          continue;
        }
        throw new Error(`Error downloading ${ url }: ${ response.statusText }`);
      }
      if (!response.body) {
        throw new Error(`Error downloading ${ url }: did not receive response body`);
      }
      const outStream = writable || new GrowingWritable(url);
      const streamFinished = stream.promises.finished(outStream);
      const progressTimeout = 5_000; // body timeout, in milliseconds.
      let abortSignal = AbortSignal.timeout(progressTimeout);
      const abortedError = new Error(`Timed out reading body`, {
        cause: {
          code:     'EAI_AGAIN',
          toString: () => 'Timed out reading body',
        },
      });
      const reader = response.body.getReader();

      while (!abortSignal.aborted) {
        const abortPromise = new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
          abortSignal.onabort = () => reject(abortedError);
        });
        const { value, done } = await Promise.race([reader.read(), abortPromise]);

        // Reset the abort signal on progress; we set up `onabort` on next iteration.
        abortSignal.onabort = null;
        abortSignal = AbortSignal.timeout(progressTimeout);
        if (done) {
          await new Promise<void>(resolve => outStream.end(resolve));
          break;
        }
        await new Promise<void>((resolve) => {
          if (outStream.write(value)) {
            resolve();
          } else {
            outStream.once('drain', resolve);
          }
        });
      }
      if (abortSignal.aborted) {
        // This can happen if we timed out waiting on `outStream.write()` etc.
        throw abortedError;
      }
      await streamFinished;
      if (!writable) {
        return (outStream as GrowingWritable).text;
      }

      return;
    } catch (ex: any) {
      const getErrorCause = (ex: any, ...codes: string[]) => {
        while (ex) {
          if (codes.includes(ex.errno) || codes.includes(ex.code)) {
            return ex;
          }
          ex = ex.cause;
        }
      };
      const errorCodes = [
        'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTDOWN',
        'ENETDOWN', 'ENETUNREACH', 'ENOTFOUND'];
      const UndiciPrefix = 'UND_ERR_'; // spellcheck-ignore-line

      errorCodes.push(...['BODY_TIMEOUT', 'CONNECT_TIMEOUT', 'REQ_RETRY', 'SOCKET'].map(e => UndiciPrefix + e ));

      const cause = getErrorCause(ex, ...errorCodes);

      if (cause) {
        console.log(`Recoverable error ${ cause } downloading ${ url } (from ${ ex }), retrying...`);
        continue;
      }
      console.dir(ex);
      throw new Error(`Error downloading ${ url }`, { cause: ex });
    }
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
  const destPathDisplay = [
    path.dirname(destPath),
    path.sep,
    '\x1B[0;1;33;40m',
    path.basename(destPath),
    '\x1B[0m',
  ].join('');

  console.log(`Downloading ${ url } to ${ destPathDisplay }`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const tempPath = `${ destPath }.download`;

  try {
    const file = fs.createWriteStream(tempPath);

    await fetchWithRetry(url, file);

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
  return await fetchWithRetry(url);
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
