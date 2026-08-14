/**
 * This module backs the "Files" tab of the container info screen.  It lets the
 * renderer browse a container's filesystem one directory at a time, preview
 * small files, and download files/directories to the host.
 *
 * Two mechanisms are used:
 *  - For running containers we `exec ... ls` to list a single directory level,
 *    which is cheap and does not transfer file contents.
 *  - For stopped containers (or when `ls` is unavailable, e.g. distroless
 *    images) we fall back to `<engine> cp <id>:<path> -`, which streams a tar
 *    archive of the path.  We parse only the tar headers, so no file contents
 *    are read while listing.
 *
 * Reading and downloading always go through the tar (`cp`) path so they work
 * regardless of whether the container is running and without depending on any
 * particular in-container tooling.
 */

import fs from 'fs';
import path from 'path';

import Electron from 'electron';
import tar from 'tar-stream';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { ReadableProcess } from '@pkg/backend/containerClient/types';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';

const console = Logging.containerFiles;
const ipcMainProxy = getIpcMainProxy(console);

/** Maximum number of bytes read when previewing a file (1 MiB). */
const MAX_PREVIEW_BYTES = 1024 * 1024;

/**
 * Maximum number of tar entries scanned when listing a directory of a stopped
 * container.  `cp` archives the directory recursively and depth-first, so a
 * very large subtree could otherwise be streamed in full; we cap the scan and
 * mark the result as truncated instead.
 */
const MAX_LIST_ENTRIES = 20_000;

export type ContainerFileType = 'file' | 'directory' | 'symlink' | 'other';

export interface ContainerFileEntry {
  /** The base name of the entry (no path separators). */
  name:        string;
  type:        ContainerFileType;
  /** Size in bytes.  Meaningful for regular files; 0 otherwise. */
  size:        number;
  /** Permission string such as `rwxr-xr-x`, when known. */
  modeString?: string;
  /** Modification time in milliseconds since the epoch, when known. */
  mtimeMs?:    number;
  /** For symlinks, the link target as stored in the container. */
  linkTarget?: string;
}

export interface ContainerFileListResult {
  entries:   ContainerFileEntry[];
  /** True when the listing was capped and may be incomplete. */
  truncated: boolean;
}

export interface ContainerFileReadResult {
  /** File contents; `utf-8` text or `base64` for binary data. */
  content:   string;
  encoding:  'utf-8' | 'base64';
  /** Byte length of the returned content (before base64 encoding). */
  size:      number;
  /** True when the file was larger than the preview cap and was truncated. */
  truncated: boolean;
}

export interface ContainerFileDownloadResult {
  /** True when the user cancelled the save dialog. */
  canceled: boolean;
  /** The host path the file/archive was written to, when not cancelled. */
  path?:    string;
}

interface FileOptions {
  namespace?: string;
  /** Hint from the renderer that the container is currently running. */
  running?:   boolean;
}

/** Convert a numeric file mode into an `rwxr-xr-x` style string. */
function modeToString(mode: number): string {
  const bits = ['r', 'w', 'x'];

  return [6, 3, 0].map((shift) => {
    const perm = (mode >> shift) & 0b111;

    return bits.map((ch, i) => ((perm >> (2 - i)) & 1) ? ch : '-').join('');
  }).join('');
}

/** Map a tar header type onto our simplified file type. */
function tarTypeToFileType(type: string | null | undefined): ContainerFileType {
  switch (type) {
  case 'directory':
    return 'directory';
  case 'symlink':
    return 'symlink';
  case 'file':
  case 'contiguous-file':
    return 'file';
  default:
    return 'other';
  }
}

export class ContainerFilesHandler {
  constructor(protected client: ContainerEngineClient) {
    this.initHandlers();
  }

  updateClient(client: ContainerEngineClient) {
    this.client = client;
  }

  /**
   * List a single directory level.  Tries `ls` for running containers and falls
   * back to streaming a tar archive otherwise.
   */
  protected async list(containerId: string, dirPath: string, options: FileOptions): Promise<ContainerFileListResult> {
    const normalized = this.normalizePath(dirPath);

    if (options.running) {
      try {
        return await this.listViaExec(containerId, normalized, options.namespace);
      } catch (ex) {
        console.debug(`ls listing failed for ${ containerId }:${ normalized }, falling back to cp:`, ex);
      }
    }

    return await this.listViaCp(containerId, normalized, options.namespace);
  }

  /** List a directory using `exec ... ls -lnA`. */
  protected async listViaExec(containerId: string, dirPath: string, namespace: string | undefined): Promise<ContainerFileListResult> {
    // -l long format, -n numeric uid/gid (avoids names containing spaces),
    // -A almost-all (no `.`/`..`).  Works on both GNU coreutils and busybox.
    const { stdout } = await this.client.runClient(
      ['exec', containerId, 'ls', '-lnA', dirPath],
      'pipe',
      { namespace },
    );

    return { entries: this.parseLsOutput(stdout), truncated: false };
  }

  /**
   * Parse the output of `ls -lnA`.  Each line looks like:
   *   drwxr-xr-x    2 0        0             4096 Jan  1 00:00 bin
   *   lrwxrwxrwx    1 0        0                7 Jan  1 00:00 sh -> busybox
   */
  parseLsOutput(stdout: string): ContainerFileEntry[] {
    const entries: ContainerFileEntry[] = [];

    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.replace(/\r$/, '');

      if (!line.trim()) {
        continue;
      }

      const tokens = line.split(/\s+/);

      // perms links uid gid size mon day time name...  => at least 9 tokens.
      if (tokens.length < 9) {
        continue;
      }

      const perms = tokens[0];

      // Skip the leading "total N" summary line and anything that is not a
      // recognizable long-format entry.
      if (!/^[-dlbcps][-rwxsStT]{9}[.+]?$/.test(perms)) {
        continue;
      }

      const size = parseInt(tokens[4], 10);
      // The name begins after the 8th field (perms links uid gid size mon day
      // time).  Re-join with single spaces; the only ambiguity this loses is
      // runs of whitespace inside names, which is rare and non-critical here.
      let name = tokens.slice(8).join(' ');
      let linkTarget: string | undefined;

      const typeChar = perms[0];
      let type: ContainerFileType = 'other';

      if (typeChar === 'd') {
        type = 'directory';
      } else if (typeChar === 'l') {
        type = 'symlink';
        const arrow = name.indexOf(' -> ');

        if (arrow >= 0) {
          linkTarget = name.slice(arrow + 4);
          name = name.slice(0, arrow);
        }
      } else if (typeChar === '-') {
        type = 'file';
      }

      entries.push({
        name,
        type,
        size:       Number.isFinite(size) ? size : 0,
        modeString: perms.slice(1, 10),
        linkTarget,
      });
    }

    return entries;
  }

  /** List a directory by streaming and parsing a `cp` tar archive. */
  protected listViaCp(containerId: string, dirPath: string, namespace: string | undefined): Promise<ContainerFileListResult> {
    const rootPrefix = dirPath === '/' ? '' : `${ path.posix.basename(dirPath) }/`;

    return this.withCpStream(containerId, dirPath, namespace, (proc, stop) => {
      return new Promise<ContainerFileListResult>((resolve, reject) => {
        const extract = tar.extract();
        const children = new Map<string, ContainerFileEntry>();
        let scanned = 0;
        let truncated = false;
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({ entries: [...children.values()], truncated });
        };

        extract.on('entry', (header, stream, next) => {
          if (settled) {
            stream.resume();

            return;
          }

          if (++scanned > MAX_LIST_ENTRIES) {
            truncated = true;
            // We have scanned enough; stop the copy and return what we have.
            stop();
            finish();
            stream.resume();

            return;
          }

          // Strip the archive root so `rel` is relative to `dirPath`.
          let rel = header.name;

          if (rootPrefix && rel.startsWith(rootPrefix)) {
            rel = rel.slice(rootPrefix.length);
          } else if (rootPrefix && `${ rel }/` === rootPrefix) {
            // The archive root entry itself.
            rel = '';
          }
          rel = rel.replace(/\/$/, '');

          if (rel) {
            const segment = rel.split('/')[0];
            const isImmediate = rel === segment;

            if (isImmediate) {
              children.set(segment, {
                name:       segment,
                type:       tarTypeToFileType(header.type),
                size:       header.size ?? 0,
                modeString: header.mode === undefined ? undefined : modeToString(header.mode),
                mtimeMs:    header.mtime ? header.mtime.getTime() : undefined,
                linkTarget: header.linkname || undefined,
              });
            } else if (!children.has(segment)) {
              // Only a deeper entry was seen; infer the intermediate directory.
              children.set(segment, { name: segment, type: 'directory', size: 0 });
            }
          }

          stream.on('end', next);
          stream.resume();
        });

        extract.on('finish', finish);
        extract.on('error', (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });

        proc.stdout.pipe(extract);
      });
    });
  }

  /** Read (a prefix of) a file's contents for previewing. */
  protected readFile(containerId: string, filePath: string, options: FileOptions): Promise<ContainerFileReadResult> {
    const normalized = this.normalizePath(filePath);

    return this.withCpStream(containerId, normalized, options.namespace, (proc, stop) => {
      return new Promise<ContainerFileReadResult>((resolve, reject) => {
        const extract = tar.extract();
        let settled = false;

        const fail = (err: Error) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        };

        extract.on('entry', (header, stream, next) => {
          if (settled || header.type !== 'file') {
            stream.on('end', next);
            stream.resume();

            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          let truncated = false;

          stream.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total <= MAX_PREVIEW_BYTES) {
              chunks.push(chunk);
            } else if (!truncated) {
              truncated = true;
              const keep = MAX_PREVIEW_BYTES - (total - chunk.length);

              if (keep > 0) {
                chunks.push(chunk.subarray(0, keep));
              }
              // Stop pulling more of this file from the container.
              stop();
            }
          });
          stream.on('end', () => {
            if (settled) {
              return;
            }
            settled = true;

            const buffer = Buffer.concat(chunks);
            const isBinary = buffer.includes(0);

            resolve({
              content:  isBinary ? buffer.toString('base64') : buffer.toString('utf-8'),
              encoding: isBinary ? 'base64' : 'utf-8',
              size:     buffer.length,
              truncated,
            });
            next();
          });
          stream.on('error', fail);
        });

        extract.on('finish', () => {
          if (!settled) {
            settled = true;
            resolve({
              content: '', encoding: 'utf-8', size: 0, truncated: false,
            });
          }
        });
        extract.on('error', fail);

        proc.stdout.pipe(extract);
      });
    });
  }

  /**
   * Prompt for a save location and copy the given path from the container to
   * the host.  Directories are saved as a `.tar` archive.
   */
  protected async download(
    event: Electron.IpcMainInvokeEvent,
    containerId: string,
    filePath: string,
    isDirectory: boolean,
    options: FileOptions,
  ): Promise<ContainerFileDownloadResult> {
    const normalized = this.normalizePath(filePath);
    const baseName = path.posix.basename(normalized) || 'download';
    const defaultName = isDirectory ? `${ baseName }.tar` : baseName;
    const window = Electron.BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const dialogOptions: Electron.SaveDialogOptions = { defaultPath: defaultName };

    const result = window
      ? await Electron.dialog.showSaveDialog(window, dialogOptions)
      : await Electron.dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const destination = result.filePath;

    await this.withCpStream(containerId, normalized, options.namespace, (proc) => {
      return new Promise<void>((resolve, reject) => {
        if (isDirectory) {
          // Save the tar archive verbatim.
          const out = fs.createWriteStream(destination);

          out.on('error', reject);
          out.on('finish', resolve);
          proc.stdout.pipe(out);

          return;
        }

        // Extract the single file entry from the archive to `destination`.
        const extract = tar.extract();
        let wrote = false;

        extract.on('entry', (header, stream, next) => {
          if (!wrote && header.type === 'file') {
            wrote = true;
            const out = fs.createWriteStream(destination);

            out.on('error', reject);
            stream.pipe(out);
            out.on('finish', next);

            return;
          }
          stream.on('end', next);
          stream.resume();
        });
        extract.on('finish', resolve);
        extract.on('error', reject);
        proc.stdout.pipe(extract);
      });
    });

    return { canceled: false, path: destination };
  }

  /**
   * Spawn `<engine> cp <id>:<path> -` and hand its stdout to `consume`.  The
   * consumer is also given a `stop()` callback to end the copy early (e.g. once
   * enough of a large file has been read); when used, the resulting non-zero
   * exit is treated as success.  Otherwise a non-zero exit rejects with the
   * captured stderr so callers see a useful error rather than an empty result.
   */
  protected async withCpStream<T>(
    containerId: string,
    srcPath: string,
    namespace: string | undefined,
    consume: (proc: ReadableProcess, stop: () => void) => Promise<T>,
  ): Promise<T> {
    const proc = this.client.runClient(
      ['cp', `${ containerId }:${ srcPath }`, '-'],
      'stream',
      { namespace },
    );

    let stderr = '';
    let stoppedEarly = false;

    const stop = () => {
      stoppedEarly = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
    };

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    const exited = new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('exit', (code, signal) => {
        if (stoppedEarly || code === 0 || signal) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `container cp exited with code ${ code }`));
        }
      });
    });

    try {
      const result = await consume(proc, stop);

      // Surface a copy failure (e.g. no such file) even if the tar parse
      // completed with an empty result.
      await exited;

      return result;
    } catch (ex) {
      stop();
      exited.catch(() => {
        // avoid an unhandled rejection when we are already throwing
      });
      throw ex;
    }
  }

  /** Normalize a POSIX path, defaulting to root and stripping trailing slashes. */
  protected normalizePath(input: string): string {
    if (!input) {
      return '/';
    }
    const normalized = path.posix.normalize(input);

    if (normalized.length > 1 && normalized.endsWith('/')) {
      return normalized.slice(0, -1);
    }

    return normalized;
  }

  protected initHandlers() {
    ipcMainProxy.handle('container-files/list', (_event, containerId, dirPath, options) => {
      return this.list(containerId, dirPath, options ?? {});
    });

    ipcMainProxy.handle('container-files/read', (_event, containerId, filePath, options) => {
      return this.readFile(containerId, filePath, options ?? {});
    });

    ipcMainProxy.handle('container-files/download', (event, containerId, filePath, isDirectory, options) => {
      return this.download(event, containerId, filePath, isDirectory, options ?? {});
    });
  }
}
