import { copyFile, rename, stat, unlink } from 'fs/promises';
import fsExtra from 'fs-extra';

export default async function safeRename(srcPath, destPath) {
  try {
    await rename(srcPath, destPath);
  } catch (e) {
    // https://github.com/nodejs/node/issues/19077 :
    // rename uses hardlinks, fails cross-devices: marked 'wontfix'
    if ((await stat(srcPath)).isDirectory()) {
      // https://github.com/jprichardson/node-fs-extra/blob/HEAD/docs/copy.md
      // "Note that if src is a directory it will copy everything inside of this directory, not the entire directory itself"
      // https://github.com/jprichardson/node-fs-extra/issues/537
      // This is exactly what we want.

      await fsExtra.copy(srcPath, destPath);
      await fsExtra.remove(srcPath);
    } else {
      await copyFile(srcPath, destPath);
      await unlink(srcPath);
    }
  }
}
