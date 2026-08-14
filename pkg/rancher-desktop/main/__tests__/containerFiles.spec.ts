/** @jest-environment node */

import { EventEmitter } from 'events';

import { jest } from '@jest/globals';
import tar from 'tar-stream';

import mockModules from '@pkg/utils/testUtils/mockModules';

const fakeProxy = { handle: jest.fn() };

mockModules({
  electron:             undefined,
  '@pkg/utils/logging': undefined,
  '@pkg/main/ipcMain':  { getIpcMainProxy: jest.fn(() => fakeProxy) },
});

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
