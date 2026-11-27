/** @jest-environment node */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

import { jest } from '@jest/globals';
import tar from 'tar-stream';

import mockModules from '@pkg/utils/testUtils/mockModules';

const fakeProxy = { handle: jest.fn() };

// electron mock with a driveable dialog/BrowserWindow for the download tests.
const showSaveDialog = jest.fn<(...args: any[]) => Promise<any>>();
const fromWebContents = jest.fn<(...args: any[]) => any>(() => null);
const electronMock = {
  app:           { isPackaged: false, getAppPath: () => path.resolve('.') },
  BrowserWindow: { fromWebContents },
  dialog:        { showSaveDialog },
  ipcMain:       {},
  ipcRenderer:   {},
  nativeTheme:   {},
  screen:        {},
  shell:         {},
};

mockModules({
  electron:             electronMock,
  '@pkg/utils/logging': undefined,
  '@pkg/main/ipcMain':  { getIpcMainProxy: jest.fn(() => fakeProxy) },
// mockModules' param union does not accept a concrete module mixed with
// `undefined` defaults; the values are validated structurally at runtime.
} as any);

let ContainerFilesHandler: Awaited<typeof import('@pkg/main/containerFiles')>['ContainerFilesHandler'];

beforeAll(async() => {
  ({ ContainerFilesHandler } = await import('@pkg/main/containerFiles'));
});

/** Build a fake ReadableProcess whose stdout is the given tar `pack` stream. */
function makeCpProcess(pack: any) {
  const proc = new EventEmitter() as any;

  proc.stdout = pack;
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  // Emit a successful `exit` once the archive has been fully streamed, mirroring
  // a real `cp` process that exits 0 after writing the tar to stdout.
  pack.on('end', () => proc.emit('exit', 0, null));

  return proc;
}

/**
 * Build a fake ReadableProcess that mimics a failed `cp` (empty stdout, a
 * message on stderr, and a non-zero exit once stdout has been consumed).
 */
function makeFailingCpProcess(stderrText: string) {
  const proc = new EventEmitter() as any;
  const stdout = new Readable({ read() {} });

  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  // Exit non-zero only after stdout has ended (deferred a tick), so the tar
  // consumer settles first and `withCpStream` is already awaiting the exit.
  stdout.on('end', () => setImmediate(() => proc.emit('exit', 1, null)));
  setImmediate(() => {
    proc.stderr.emit('data', Buffer.from(stderrText));
    stdout.push(null);
  });

  return proc;
}

interface PackEntry {
  name:      string;
  type?:     string;
  mode?:     number;
  linkname?: string;
  body?:     string | Buffer;
}

/** Assemble a tar stream from the given entries. */
function makePack(entries: PackEntry[]) {
  const pack = tar.pack();

  for (const entry of entries) {
    const body = entry.body ?? '';
    const size = Buffer.byteLength(body);

    pack.entry({
      name:     entry.name,
      type:     (entry.type as any) ?? 'file',
      mode:     entry.mode ?? 0o644,
      size,
      linkname: entry.linkname,
    }, body as any);
  }
  pack.finalize();

  return pack;
}

describe('ContainerFilesHandler', () => {
  let mockClient: { runClient: jest.Mock };
  let handler: any;

  beforeEach(() => {
    mockClient = { runClient: jest.fn() };
    handler = new ContainerFilesHandler(mockClient as any);
    showSaveDialog.mockReset();
    fromWebContents.mockReset().mockReturnValue(null);
  });

  describe('parseLsOutput', () => {
    it('parses GNU-style long listings', () => {
      const output = [
        'total 20',
        'drwxr-xr-x    2 0        0             4096 Jan  1 00:00 bin',
        '-rw-r--r--    1 0        0              220 Jan  1 00:00 .bashrc',
        'lrwxrwxrwx    1 0        0                7 Jan  1 00:00 sh -> busybox',
      ].join('\n');

      const entries = handler.parseLsOutput(output);

      expect(entries).toEqual([
        {
          name: 'bin', type: 'directory', size: 4096, modeString: 'rwxr-xr-x', linkTarget: undefined,
        },
        {
          name: '.bashrc', type: 'file', size: 220, modeString: 'rw-r--r--', linkTarget: undefined,
        },
        {
          name: 'sh', type: 'symlink', size: 7, modeString: 'rwxrwxrwx', linkTarget: 'busybox',
        },
      ]);
    });

    it('skips the total line and blank lines', () => {
      const entries = handler.parseLsOutput('total 0\n\n');

      expect(entries).toEqual([]);
    });

    it('handles file names containing spaces', () => {
      const entries = handler.parseLsOutput('-rw-r--r--    1 0        0               10 Jan  1 00:00 my file.txt');

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('my file.txt');
    });
  });

  describe('listViaCp', () => {
    it('returns only immediate children of the directory', async() => {
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'etc/', type: 'directory', mode: 0o755 },
        { name: 'etc/hostname', body: 'host\n' },
        { name: 'etc/ssl/', type: 'directory', mode: 0o755 },
        { name: 'etc/ssl/certs/ca.pem', body: 'x' },
      ])));

      const result = await handler.listViaCp('abc', '/etc', undefined);
      const byName = Object.fromEntries(result.entries.map((e: any) => [e.name, e]));

      expect(result.truncated).toBe(false);
      expect(Object.keys(byName).sort()).toEqual(['hostname', 'ssl']);
      expect(byName.hostname.type).toBe('file');
      expect(byName.hostname.size).toBe(5);
      expect(byName.ssl.type).toBe('directory');
    });

    it('infers intermediate directories when no explicit entry exists', async() => {
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'etc/deep/file', body: 'x' },
      ])));

      const result = await handler.listViaCp('abc', '/etc', undefined);

      expect(result.entries).toEqual([{ name: 'deep', type: 'directory', size: 0 }]);
    });

    it('lists top-level entries when browsing the root', async() => {
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'bin/', type: 'directory', mode: 0o755 },
        { name: 'etc/', type: 'directory', mode: 0o755 },
      ])));

      const result = await handler.listViaCp('abc', '/', undefined);

      expect(result.entries.map((e: any) => e.name).sort()).toEqual(['bin', 'etc']);
    });

    it('lists the root when the archive wraps entries under "./" (docker cp)', async() => {
      // `docker cp <id>:/ -` emits a `.`-rooted archive; ensure the wrapper is
      // stripped rather than collapsing everything into a single "." node.
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: './', type: 'directory', mode: 0o755 },
        { name: './bin/', type: 'directory', mode: 0o755 },
        { name: './bin/sh', body: 'x' },
        { name: './etc/', type: 'directory', mode: 0o755 },
        { name: './usr/local/bin/', type: 'directory', mode: 0o755 },
      ])));

      const result = await handler.listViaCp('abc', '/', undefined);

      expect(result.entries.map((e: any) => e.name).sort()).toEqual(['bin', 'etc', 'usr']);
      expect(result.entries.every((e: any) => e.type === 'directory')).toBe(true);
    });

    it('strips a base-name wrapper for nested directories', async() => {
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'ssl/', type: 'directory', mode: 0o755 },
        { name: 'ssl/openssl.cnf', body: 'x' },
        { name: 'ssl/certs/', type: 'directory', mode: 0o755 },
      ])));

      const result = await handler.listViaCp('abc', '/etc/ssl', undefined);

      expect(result.entries.map((e: any) => e.name).sort()).toEqual(['certs', 'openssl.cnf']);
    });
  });

  describe('readFile', () => {
    it('reads a text file as utf-8', async() => {
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'hostname', body: 'my-host\n' },
      ])));

      const result = await handler.readFile('abc', '/etc/hostname', {});

      expect(result.encoding).toBe('utf-8');
      expect(result.content).toBe('my-host\n');
      expect(result.truncated).toBe(false);
    });

    it('returns binary files as base64', async() => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff]);

      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'blob', body: binary },
      ])));

      const result = await handler.readFile('abc', '/blob', {});

      expect(result.encoding).toBe('base64');
      expect(Buffer.from(result.content, 'base64')).toEqual(binary);
    });

    it('caps the preview at 1 MiB and marks it truncated', async() => {
      const big = Buffer.alloc((1024 * 1024) + 4096, 0x61); // 1 MiB + 4 KiB of 'a'

      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'big.log', body: big },
      ])));

      const result = await handler.readFile('abc', '/big.log', {});

      expect(result.truncated).toBe(true);
      expect(result.size).toBe(1024 * 1024);
      expect(result.content.length).toBe(1024 * 1024);
    });
  });

  describe('list (running vs stopped dispatch)', () => {
    // Route `exec ... ls` and `cp ... -` to different fakes based on argv.
    function routeRunClient(opts: { ls?: string | Error, cp?: any }) {
      mockClient.runClient.mockImplementation((args: any) => {
        if (args[0] === 'exec') {
          if (opts.ls instanceof Error) {
            return Promise.reject(opts.ls);
          }

          return Promise.resolve({ stdout: opts.ls ?? '', stderr: '' });
        }
        if (args[0] === 'cp') {
          return opts.cp;
        }
        throw new Error(`unexpected runClient args: ${ args.join(' ') }`);
      });
    }

    it('uses `ls` (not cp) for a running container', async() => {
      routeRunClient({ ls: '-rw-r--r--    1 0        0               10 Jan  1 00:00 hello.txt' });

      const result = await handler.list('abc', '/app', { running: true });

      expect(result.entries).toEqual([
        { name: 'hello.txt', type: 'file', size: 10, modeString: 'rw-r--r--', linkTarget: undefined },
      ]);
      // Only `exec` should have been invoked; no cp fallback.
      expect(mockClient.runClient.mock.calls.every((c: any) => c[0][0] === 'exec')).toBe(true);
    });

    it('falls back to cp when `ls` fails (e.g. distroless without ls)', async() => {
      routeRunClient({
        ls: new Error('OCI runtime exec failed: exec: "ls": not found'),
        cp: makeCpProcess(makePack([{ name: 'app/', type: 'directory', mode: 0o755 }, { name: 'app/main', body: 'x' }])),
      });

      const result = await handler.list('abc', '/app', { running: true });

      expect(result.entries.map((e: any) => e.name)).toEqual(['main']);
      expect(mockClient.runClient.mock.calls.some((c: any) => c[0][0] === 'cp')).toBe(true);
    });

    it('uses cp directly for a stopped container (no exec attempt)', async() => {
      routeRunClient({ cp: makeCpProcess(makePack([{ name: 'app/', type: 'directory' }, { name: 'app/main', body: 'x' }])) });

      const result = await handler.list('abc', '/app', { running: false });

      expect(result.entries.map((e: any) => e.name)).toEqual(['main']);
      expect(mockClient.runClient.mock.calls.every((c: any) => c[0][0] === 'cp')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('rejects readFile with the cp stderr when the copy fails', async() => {
      mockClient.runClient.mockReturnValue(
        makeFailingCpProcess('Error: No such container:path: /nope'),
      );

      await expect(handler.readFile('abc', '/nope', {})).rejects.toThrow('No such container:path');
    });

    it('rejects listViaCp when the copy fails rather than returning empty', async() => {
      mockClient.runClient.mockReturnValue(makeFailingCpProcess('lstat /bogus: no such file or directory'));

      await expect(handler.listViaCp('abc', '/bogus', undefined)).rejects.toThrow('no such file or directory');
    });
  });

  describe('download', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-files-test-'));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns { canceled: true } and writes nothing when the dialog is cancelled', async() => {
      showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([{ name: 'hostname', body: 'x' }])));

      const result = await handler.download({ sender: {} }, 'abc', '/etc/hostname', false, {});

      expect(result).toEqual({ canceled: true });
      expect(mockClient.runClient).not.toHaveBeenCalled();
    });

    it('extracts a single file to the chosen path', async() => {
      const dest = path.join(tmpDir, 'hostname');

      showSaveDialog.mockResolvedValue({ canceled: false, filePath: dest });
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([{ name: 'hostname', body: 'my-host\n' }])));

      const result = await handler.download({ sender: {} }, 'abc', '/etc/hostname', false, {});

      expect(result).toEqual({ canceled: false, path: dest });
      expect(fs.readFileSync(dest, 'utf-8')).toBe('my-host\n');
    });

    it('saves a directory as a .tar archive', async() => {
      const dest = path.join(tmpDir, 'log.tar');

      showSaveDialog.mockResolvedValue({ canceled: false, filePath: dest });
      mockClient.runClient.mockReturnValue(makeCpProcess(makePack([
        { name: 'log/', type: 'directory', mode: 0o755 },
        { name: 'log/apk.log', body: 'installed\n' },
      ])));

      const result = await handler.download({ sender: {} }, 'abc', '/var/log', true, {});

      expect(result.canceled).toBe(false);

      // The saved file should be a valid tar containing the entries verbatim.
      const names: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const extract = tar.extract();

        extract.on('entry', (header, stream, next) => {
          names.push(header.name);
          stream.on('end', next);
          stream.resume();
        });
        extract.on('finish', () => resolve());
        extract.on('error', reject);
        fs.createReadStream(dest).pipe(extract);
      });

      expect(names).toContain('log/apk.log');
    });
  });

  describe('normalizePath', () => {
    it.each([
      ['', '/'],
      ['/', '/'],
      ['/etc/', '/etc'],
      ['/etc/../etc/ssl', '/etc/ssl'],
    ])('normalizes %j to %j', (input, expected) => {
      expect(handler.normalizePath(input)).toBe(expected);
    });
  });
});
