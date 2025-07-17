import fs from 'fs';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';

import * as childProcess from '@pkg/utils/childProcess';
import { withResource } from '@pkg/utils/testUtils/mockResources';
import mockModules from '@pkg/utils/testUtils/mockModules';

const modules = mockModules({
  fs: {
    ...fs,
    promises:{
      ...fs.promises,
      rename: jest.fn(fs.promises.rename),
      writeFile: jest.fn(fs.promises.writeFile),
    },
  },
});

const describeUnix = process.platform === 'win32' ? describe.skip : describe;
const testUnix = process.platform === 'win32' ? test.skip : test;

const FILE_NAME = 'fakercfile';
const TEST_LINE_1 = 'this is test line 1';
const TEST_LINE_2 = 'this is test line 2';

const { default: manageLinesInFile, START_LINE, END_LINE } = await import('@pkg/integrations/manageLinesInFile');

let testDir: string;
let rcFilePath: string;
let backupFilePath: string;
let tempFilePath: string;
let symlinkPath: string;
let SystemError: new (key: string, context: {code: string, syscall: string, message: string}) => NodeJS.ErrnoException;

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
  rcFilePath = path.join(testDir, FILE_NAME);
  backupFilePath = `${ rcFilePath }.rd-backup~`;
  tempFilePath = `${ rcFilePath }.rd-temp`;
  symlinkPath = `${ rcFilePath }.real`;
  SystemError = await (async() => {
    try {
      await fs.promises.readFile(rcFilePath);
    } catch (ex) {
      return Object.getPrototypeOf(ex).constructor;
    }
  })();
});

afterEach(async() => {
  // It is best to be careful around rm's; we don't want to remove important things.
  if (testDir) {
    await fs.promises.rm(testDir, {
      recursive: true, force: true, maxRetries: 5,
    });
  }
});

describe('manageLinesInFile', () => {
  describe('Target does not exist', () => {
    test('Create the file when desired', async() => {
      const expectedContents = [START_LINE, TEST_LINE_1, END_LINE, ''].join('\n');

      await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);

      await expect(fs.promises.readFile(rcFilePath, 'utf8')).resolves.toEqual(expectedContents);
      await expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(backupFilePath)).rejects.toHaveProperty('code', 'ENOENT');
    });

    test('Do nothing when not desired', async() => {
      await expect(manageLinesInFile(rcFilePath, [TEST_LINE_1], false)).resolves.not.toThrow();
      await expect(fs.promises.readFile(rcFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(backupFilePath)).rejects.toHaveProperty('code', 'ENOENT');
    });
  });

  describe('Target exists as a plain file', () => {
    testUnix('Preserves extended attributes', async() => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- This only fails on Windows
      // @ts-ignore // fs-xattr is not available on Windows.
      const { get, list, set } = await import('fs-xattr');

      const unmanagedContents = 'existing lines\n';
      const attributeKey = 'user.io.rancherdesktop.test';
      const attributeValue = 'sample attribute contents';

      await fs.promises.writeFile(rcFilePath, unmanagedContents);
      await set(rcFilePath, attributeKey, attributeValue);
      await expect(manageLinesInFile(rcFilePath, [TEST_LINE_1], true)).resolves.not.toThrow();

      const allAttrs: string[] = await list(rcFilePath);
      // filter out attributes like com.apple.provenance that the OS might add
      const filteredAttrs = allAttrs.filter(item => !item.startsWith('com.apple.'));

      expect(filteredAttrs).toEqual([attributeKey]);
      await expect(get(rcFilePath, attributeKey)).resolves.toEqual(Buffer.from(attributeValue, 'utf-8'));
    });

    test('Delete file when false and it contains only the managed lines', async() => {
      const data = [START_LINE, TEST_LINE_1, END_LINE].join('\n');

      await fs.promises.writeFile(rcFilePath, data, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.readFile(rcFilePath, 'utf8')).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(backupFilePath)).rejects.toHaveProperty('code', 'ENOENT');
    });

    test('Put lines in file that exists and has content', async() => {
      const data = 'this is already present in the file\n';
      const expectedContents = [data, START_LINE, TEST_LINE_1, END_LINE, ''].join('\n');

      await fs.promises.writeFile(rcFilePath, data, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);

      await expect(fs.promises.readFile(rcFilePath, 'utf8')).resolves.toEqual(expectedContents);
      if (process.platform !== 'win32') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- This only fails on Windows
        // @ts-ignore // fs-xattr is not available on Windows.
        const { list } = await import('fs-xattr');
        const allAttrs: string[] = await list(rcFilePath);
        // filter out attributes like com.apple.provenance that the OS might add
        const filteredAttrs = allAttrs.filter(item => !item.startsWith('com.apple.'));

        expect(filteredAttrs).toHaveLength(0);
      }
    });

    test('Remove lines from file that exists and has content', async() => {
      const unmanagedContents = 'this is already present in the file\n';
      const contents = [unmanagedContents, START_LINE, TEST_LINE_1, END_LINE, ''].join('\n');

      expect(contents).toMatch(/(?<!\n)\n$/);
      await fs.promises.writeFile(rcFilePath, contents, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.readFile(rcFilePath, 'utf8')).resolves.toEqual(unmanagedContents);
    });

    test('Update managed lines', async() => {
      const topUnmanagedContents = 'this is at the top of the file\n';
      const bottomUnmanagedContents = 'this is at the bottom of the file\n';
      const contents = [
        topUnmanagedContents, START_LINE, TEST_LINE_1, END_LINE, bottomUnmanagedContents].join('\n');
      const expectedNewContents = [
        topUnmanagedContents, START_LINE, TEST_LINE_1, TEST_LINE_2, END_LINE,
        bottomUnmanagedContents].join('\n');

      await fs.promises.writeFile(rcFilePath, contents, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1, TEST_LINE_2], true);

      await expect(fs.promises.readFile(rcFilePath, 'utf8')).resolves.toEqual(expectedNewContents);
    });

    test('Remove managed lines from between unmanaged lines', async() => {
      const topUnmanagedContents = 'this is at the top of the file\n';
      const bottomUnmanagedContents = 'this is at the bottom of the file\n';
      const contents = [
        topUnmanagedContents, START_LINE, TEST_LINE_1, END_LINE, bottomUnmanagedContents].join('\n');
      const expectedNewContents = [topUnmanagedContents, bottomUnmanagedContents].join('\n');

      await fs.promises.writeFile(rcFilePath, contents, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.readFile(rcFilePath, 'utf8')).resolves.toEqual(expectedNewContents);
    });

    test('File mode should not be changed when updating a file', async() => {
      const unmanagedContents = 'this is already present in the file\n';
      const contents = [unmanagedContents, START_LINE, TEST_LINE_1, END_LINE].join('\n');

      await fs.promises.writeFile(rcFilePath, contents, { mode: 0o623 });
      const { mode: actualMode } = await fs.promises.stat(rcFilePath);

      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.stat(rcFilePath)).resolves.toHaveProperty('mode', actualMode);
    });

    test('Should not write directly to target file', async() => {
      const unmanagedContents = 'existing lines\n';

      await fs.promises.writeFile(rcFilePath, unmanagedContents, { mode: 0o600 });

      using spyWriteFile = withResource(modules.fs.promises.writeFile);
      using spyRename = withResource(modules.fs.promises.rename);

      await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);
      expect(spyWriteFile).not.toHaveBeenCalledWith(rcFilePath, expect.anything());
      expect(spyRename).toHaveBeenCalledWith(tempFilePath, rcFilePath);
      expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      expect(fs.promises.readFile(backupFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      expect(fs.promises.readFile(rcFilePath, 'utf-8')).resolves
        .toEqual([unmanagedContents, START_LINE, TEST_LINE_1, END_LINE, ''].join('\n'));
    });

    test('Handles errors writing to temporary file', async() => {
      const unmanagedContents = 'existing lines\n';

      await fs.promises.writeFile(rcFilePath, unmanagedContents, { mode: 0o600 });
      const originalWriteFile = fs.promises.writeFile;

      using spyWriteFile = withResource(modules.fs.promises.writeFile)
        .mockImplementation(async(file, data, options) => {
          if (file.toString() === tempFilePath) {
            throw new SystemError('EACCESS', {
              code: 'EACCESS', syscall: 'write', message: '',
            });
          }
          await originalWriteFile(file, data, options);
        });

      await expect(manageLinesInFile(rcFilePath, [TEST_LINE_1], true)).rejects.not.toBeUndefined();
      expect(spyWriteFile).toHaveBeenCalledWith(tempFilePath, expect.anything(), expect.anything());
      // The file should not have been modified
      expect(fs.promises.readFile(rcFilePath, 'utf-8')).resolves.toEqual(unmanagedContents);
      expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      expect(fs.promises.readFile(backupFilePath)).rejects.toHaveProperty('code', 'ENOENT');
    });
  });

  describeUnix('Target is a symlink', () => {
    beforeEach(async() => {
      await fs.promises.symlink(symlinkPath, rcFilePath, 'file');
    });

    test('Aborts if backup file already exists', async() => {
      const backupContents = 'this is never read';
      const unmanagedContents = 'existing lines\n';

      await fs.promises.writeFile(symlinkPath, unmanagedContents);
      await fs.promises.writeFile(backupFilePath, backupContents);

      await expect(manageLinesInFile(rcFilePath, ['hello'], true)).rejects.toThrow();
      await expect(fs.promises.readFile(rcFilePath, 'utf-8')).resolves.toEqual(unmanagedContents);
      await expect(fs.promises.readFile(backupFilePath, 'utf-8')).resolves.toEqual(backupContents);
      await expect(fs.promises.readlink(rcFilePath)).resolves.toEqual(symlinkPath);
    });

    test('Leave the file empty if removing all content', async() => {
      const data = [START_LINE, TEST_LINE_1, END_LINE].join('\n');

      await fs.promises.writeFile(symlinkPath, data, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.readFile(symlinkPath, 'utf8')).resolves.toEqual('');
      await expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(backupFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readlink(rcFilePath)).resolves.toEqual(symlinkPath);
    });

    test('Put lines in file that exists and has content', async() => {
      const data = 'this is already present in the file\n';
      const expectedContents = [data, START_LINE, TEST_LINE_1, END_LINE, ''].join('\n');

      await fs.promises.writeFile(symlinkPath, data, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);

      await expect(fs.promises.readFile(symlinkPath, 'utf-8')).resolves.toEqual(expectedContents);
      await expect(fs.promises.readlink(rcFilePath, 'utf-8')).resolves.toEqual(symlinkPath);
    });

    test('Remove lines from file that exists and has content', async() => {
      const unmanagedContents = 'this is already present in the file\n';
      const contents = [unmanagedContents, START_LINE, TEST_LINE_1, END_LINE, ''].join('\n');

      await fs.promises.writeFile(symlinkPath, contents, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.readFile(symlinkPath, 'utf-8')).resolves.toEqual(unmanagedContents);
      await expect(fs.promises.readlink(rcFilePath, 'utf-8')).resolves.toEqual(symlinkPath);
    });

    test('Update managed lines', async() => {
      const topUnmanagedContents = 'this is at the top of the file\n';
      const bottomUnmanagedContents = 'this is at the bottom of the file\n';
      const contents = [
        topUnmanagedContents, START_LINE, TEST_LINE_1, END_LINE, bottomUnmanagedContents].join('\n');
      const expectedNewContents = [
        topUnmanagedContents, START_LINE, TEST_LINE_1, TEST_LINE_2, END_LINE,
        bottomUnmanagedContents].join('\n');

      await fs.promises.writeFile(symlinkPath, contents, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1, TEST_LINE_2], true);

      await expect(fs.promises.readFile(symlinkPath, 'utf8')).resolves.toEqual(expectedNewContents);
      await expect(fs.promises.readlink(rcFilePath, 'utf-8')).resolves.toEqual(symlinkPath);
    });

    test('Remove managed lines from between unmanaged lines', async() => {
      const topUnmanagedContents = 'this is at the top of the file\n';
      const bottomUnmanagedContents = 'this is at the bottom of the file\n';
      const contents = [
        topUnmanagedContents, START_LINE, TEST_LINE_1, END_LINE, bottomUnmanagedContents].join('\n');
      const expectedNewContents = [topUnmanagedContents, bottomUnmanagedContents].join('\n');

      await fs.promises.writeFile(symlinkPath, contents, { mode: 0o644 });
      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.readFile(symlinkPath, 'utf8')).resolves.toEqual(expectedNewContents);
      await expect(fs.promises.readlink(rcFilePath, 'utf-8')).resolves.toEqual(symlinkPath);
    });

    test('File mode should not be changed when updating a file', async() => {
      const unmanagedContents = 'this is already present in the file\n';
      const contents = [unmanagedContents, START_LINE, TEST_LINE_1, END_LINE].join('\n');

      await fs.promises.writeFile(symlinkPath, contents, { mode: 0o623 });
      const { mode: actualMode } = await fs.promises.stat(symlinkPath);

      await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);

      await expect(fs.promises.stat(symlinkPath)).resolves.toHaveProperty('mode', actualMode);
      await expect(fs.promises.readlink(rcFilePath, 'utf-8')).resolves.toEqual(symlinkPath);
    });

    test('Write backup file during operation', async() => {
      const unmanagedContents = 'existing lines\n';

      await fs.promises.writeFile(rcFilePath, unmanagedContents, { mode: 0o600 });
      const originalWriteFile = fs.promises.writeFile;

      using spyWriteFile = withResource(modules.fs.promises.writeFile)
        .mockImplementation(async(file, data, options) => {
          if (file !== rcFilePath) {
            // Don't fail when writing to any other files.
            await originalWriteFile(file, data, options);

            return;
          }
          // When doing the actual write, the backup file should already have
          // the old contents.
          expect(await fs.promises.readFile(backupFilePath)).toEqual(unmanagedContents);
          // We also haven't written to the target file yet.
          expect(await fs.promises.readFile(symlinkPath)).toEqual(unmanagedContents);
          // Throw an error and let it recover.
          throw new SystemError('EIO', {
            code: 'EIO', syscall: 'write', message: 'Fake error',
          });
        });

      await expect(manageLinesInFile(rcFilePath, [TEST_LINE_1], true)).rejects.toThrow();
      expect(spyWriteFile).toHaveBeenCalledWith(rcFilePath, expect.anything(), expect.anything());
      await expect(fs.promises.readFile(tempFilePath)).rejects.toHaveProperty('code', 'ENOENT');
      await expect(fs.promises.readFile(backupFilePath, 'utf-8')).resolves.toEqual(unmanagedContents);
    });
  });

  describeUnix('Target is neither normal file nor symlink', () => {
    // An incorrect implementation would write into the pipe and block, so
    // set a timeout to ensure we bail in that case.
    test('Abort if target is not a file', async() => {
      await childProcess.spawnFile('mknod', [rcFilePath, 'p']);
      await expect(manageLinesInFile(rcFilePath, [], true)).rejects.toThrow();
      await expect(childProcess.spawnFile('test', ['-p', rcFilePath])).resolves.not.toThrow();
    }, 1_000);
  });
});
