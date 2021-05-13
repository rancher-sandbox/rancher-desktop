import childProcess from 'child_process';
import fsPromises from 'fs/promises';
import fs from 'fs';
import os from 'os';
import { join, resolve } from 'path';
import util from 'util';

import safeRename from '../safeRename.js';

const assetsDir = resolve('./src/utils/__tests__/assets/safeRename');
let targetDir;

/* input tar file contents:
 * rename1.txt
 * a/
 *   a1.txt
 *   a2.txt
 *   b/
 *     b1.txt
 */

jest.mock('fs');
const mockFunc = jest.fn().mockImplementation(() => {
  throw new Error('EXDEV: cross-device link not permittted');
});

fsPromises.rename = mockFunc;

// async function fileExists(path) {
//   return await new Promise((resolve) => {
//     fs.access(path, fs.constants.F_OK, (err) => {
//       resolve(!!err);
//     });
//   });
// }

function fileExists(path) {
  try {
    fs.accessSync(path, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

describe('safeRename', () => {
  beforeEach(async() => {
    await childProcess.spawn('tar', ['xf', join(assetsDir, 'safeRename.tar')], { cwd: assetsDir });
    targetDir = await fsPromises.mkdtemp(join(os.tmpdir(), 'rename-'));
  });
  afterEach(async() => {
    // cleanup
    try {
      await fsPromises.unlink(targetDir);
    } catch (_) {}
    for (const entry of ['rename1.txt', 'a']) {
      try {
        await fsPromises.unlink(join(assetsDir, entry));
      } catch (_) {}
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
    console.log(`QQQ: checking for ${ join(destPath, 'a1.txt') }`);
    expect(fileExists(join(destPath, 'a1.txt'))).toBeFalsy();
    expect(fileExists(join(destPath, 'a2.txt'))).toBeFalsy();
    expect(fileExists(join(destPath, 'b/b1.txt'))).toBeFalsy();
  });
});
