import childProcess from 'child_process';
import fsPromises from 'fs/promises';
import fs from 'fs';
import os from 'os';
import { join, resolve } from 'path';
import { remove as extraRemove } from 'fs-extra';

import safeRename from '../safeRename.js';

const assetsDir = resolve('./src/utils/__tests__/assets/safeRename');

/* input tar file contents:
 * rename1.txt
 * a/
 *   a1.txt
 *   a2.txt
 *   b/
 *     b1.txt
 */

const mockFunc = jest.fn().mockImplementation(() => {
  throw new Error('EXDEV: cross-device link not permittted');
});

fsPromises.rename = mockFunc;

function fileExists(path) {
  try {
    fs.accessSync(path, fs.constants.F_OK);

    return true;
  } catch (_) {
    return false;
  }
}

describe('safeRename', () => {
  let targetDir;

  beforeEach(() => {
    childProcess.execFileSync('tar', ['xf', join(assetsDir, 'safeRename.tar')], { cwd: assetsDir });
    targetDir = fs.mkdtempSync(join(os.tmpdir(), 'rename-'));
  });
  afterEach(async() => {
    // cleanup
    for (const entry of [targetDir, 'rename1.txt', 'a']) {
      try {
        const fullPath = entry[0] === '/' ? entry : join(assetsDir, entry);

        if (fileExists(fullPath)) {
          await extraRemove(fullPath);
        }
      } catch (e) {
        console.log(`Failed to delete ${ entry }: ${ e }`);
      }
    }
  });

  test('can rename a file, specifying the full dest path', async() => {
    const srcPath = join(assetsDir, 'rename1.txt');
    const destPath = join(targetDir, 'newname1.txt');

    await safeRename(srcPath, destPath);
    expect(fileExists(destPath)).toBeTruthy();
    expect(fileExists(srcPath)).toBeFalsy();
  });

  test('can rename a dir', async() => {
    const srcPath = join(assetsDir, 'a');
    const destPath = join(targetDir, 'new_a');

    await safeRename(srcPath, destPath);
    expect(fileExists(destPath)).toBeTruthy();
    expect(fileExists(srcPath)).toBeFalsy();
    expect(fileExists(join(destPath, 'a1.txt'))).toBeTruthy();
    expect(fileExists(join(destPath, 'a2.txt'))).toBeTruthy();
    expect(fileExists(join(destPath, 'b/b1.txt'))).toBeTruthy();
  });
});
