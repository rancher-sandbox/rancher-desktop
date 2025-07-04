import childProcess from 'child_process';
import fs from 'fs';
import { rename } from 'fs/promises';
import os from 'os';
import { join, resolve } from 'path';

import { jest } from '@jest/globals';
import { copy as extraCopy, remove as extraRemove } from 'fs-extra';

import mockModules from '../testUtils/mockModules';

const assetsDir = resolve('./pkg/rancher-desktop/utils/__tests__/assets/safeRename');

const modules = mockModules({
  fs: {
    ...fs,
    promises: {
      ...fs.promises,
      copyFile: jest.spyOn(fs.promises, 'copyFile'),
      rename: jest.spyOn(fs.promises, 'rename'),
      unlink: jest.spyOn(fs.promises, 'unlink'),
    }
  },
  'fs-extra': {
    copy: jest.fn(extraCopy),
  },
});

/* input tar file contents:
 * rename1.txt
 * a/
 *   a1.txt
 *   a2.txt
 *   b/
 *     b1.txt
 */

function fileExists(path: string) {
  try {
    fs.accessSync(path, fs.constants.F_OK);

    return true;
  } catch (_) {
    return false;
  }
}

const { default: safeRename } = await import('../safeRename');

describe('safeRename', () => {
  let tarDir: string;
  let targetDir: string;

  beforeEach(() => {
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? '', 'system32', 'tar.exe') : 'tar';

    tarDir = fs.mkdtempSync(join(os.tmpdir(), 'renameS-'));
    childProcess.execFileSync(tar, ['xf', join(assetsDir, 'safeRename.tar'), '-C', tarDir], { cwd: assetsDir });
    targetDir = fs.mkdtempSync(join(os.tmpdir(), 'renameD-'));

    modules.fs.promises.rename.mockImplementation(rename);
  });
  afterEach(async() => {
    // cleanup
    for (const fullPath of [targetDir, tarDir]) {
      try {
        if (fileExists(fullPath)) {
          await extraRemove(fullPath);
        }
      } catch (e) {
        console.log(`Failed to delete ${ fullPath }: ${ e }`);
      }
    }
  });

  describe('rename fails', () => {
    beforeEach(() => {
      modules.fs.promises.rename.mockImplementation(() => {
        throw new Error('EXDEV: cross-device link not permitted');
      });
    });
    afterEach(() => {
      modules.fs.promises.rename.mockReset();
    });

    test('can rename a file, specifying the full dest path', async() => {
      const srcPath = join(tarDir, 'rename1.txt');
      const destPath = join(targetDir, 'newname1.txt');

      await safeRename(srcPath, destPath);
      expect(modules.fs.promises.copyFile).toHaveBeenCalled();
      expect(modules.fs.promises.unlink).toHaveBeenCalled();
      expect(fileExists(destPath)).toBeTruthy();
      expect(fileExists(srcPath)).toBeFalsy();
    });

    test('can rename a dir', async() => {
      const srcPath = join(tarDir, 'a');
      const destPath = join(targetDir, 'new_a');

      await safeRename(srcPath, destPath);
      expect(modules['fs-extra'].copy).toHaveBeenCalled();
      expect(fileExists(destPath)).toBeTruthy();
      expect(fileExists(srcPath)).toBeFalsy();
      expect(fileExists(join(destPath, 'a1.txt'))).toBeTruthy();
      expect(fileExists(join(destPath, 'a2.txt'))).toBeTruthy();
      expect(fileExists(join(destPath, 'b/b1.txt'))).toBeTruthy();
    });
  });

  describe('rename works', () => {
    const nonExceptionMockFunc = () => {
      throw new Error('Should not have failed when using standard rename');
    };

    beforeEach(() => {
      modules.fs.promises.copyFile.mockImplementation(nonExceptionMockFunc);
      modules.fs.promises.unlink.mockImplementation(nonExceptionMockFunc);
    });
    afterEach(() => {
      modules.fs.promises.copyFile.mockRestore();
      modules.fs.promises.unlink.mockRestore();
    });

    test('can rename a file, specifying the full dest path', async() => {
      const srcPath = join(tarDir, 'rename1.txt');
      const destPath = join(targetDir, 'newname1.txt');

      await safeRename(srcPath, destPath);
      expect(fileExists(destPath)).toBeTruthy();
      expect(fileExists(srcPath)).toBeFalsy();
    });

    test('can rename a dir', async() => {
      const srcPath = join(tarDir, 'a');
      const destPath = join(targetDir, 'new_a');

      await safeRename(srcPath, destPath);
      expect(fileExists(destPath)).toBeTruthy();
      expect(fileExists(srcPath)).toBeFalsy();
      expect(fileExists(join(destPath, 'a1.txt'))).toBeTruthy();
      expect(fileExists(join(destPath, 'a2.txt'))).toBeTruthy();
      expect(fileExists(join(destPath, 'b/b1.txt'))).toBeTruthy();
    });
  });
});
