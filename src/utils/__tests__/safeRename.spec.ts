import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import { join, resolve } from 'path';
import { remove as extraRemove } from 'fs-extra';

import safeRename from '../safeRename';

const fsPromises = fs.promises;
const assetsDir = resolve('./src/utils/__tests__/assets/safeRename');

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

describe('safeRename', () => {
  let tarDir: string;
  let targetDir: string;

  beforeEach(() => {
    tarDir = fs.mkdtempSync(join(os.tmpdir(), 'renameS-'));
    childProcess.execFileSync('tar', ['xf', join(assetsDir, 'safeRename.tar'), '-C', tarDir], { cwd: assetsDir });
    targetDir = fs.mkdtempSync(join(os.tmpdir(), 'renameD-'));
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
    const renameMockFunc = jest.fn().mockImplementation(() => {
      throw new Error('EXDEV: cross-device link not permitted');
    });
    const renameFunc = fsPromises.rename;

    beforeEach(() => {
      fsPromises.rename = renameMockFunc;
    });
    afterEach(() => {
      fsPromises.rename = renameFunc;
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

  describe('rename works', () => {
    const nonExceptionMockFunc = jest.fn().mockImplementation(() => {
      throw new Error('Should not have failed when using standard rename');
    });
    const copyFileFunc = fsPromises.copyFile;
    const unlinkFunc = fsPromises.unlink;

    beforeEach(() => {
      fsPromises.copyFile = nonExceptionMockFunc;
      fsPromises.unlink = nonExceptionMockFunc;
    });
    afterEach(() => {
      fsPromises.copyFile = copyFileFunc;
      fsPromises.unlink = unlinkFunc;
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
