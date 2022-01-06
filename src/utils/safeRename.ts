import fs from 'fs';
import fsExtra from 'fs-extra';

const fsPromises = fs.promises;

/**
 * Normally we can use `fs.rename` to relocate (and rename) both files and directories.
 * But there is a known limitation that on Windows systems `fs.rename` fails when the
 * source and destination are on different drives. Same for different volumes on Unix-based systems.
 * So if `fs.rename` fails, this function does a `copy` and `delete` instead.
 *
 * The `safe` in `safeRename` is because using this function for existing arguments should not throw
 * an exception.
 *
 * @param srcPath: string
 * @param destPath: string
 */
export default async function safeRename(srcPath: string, destPath: string): Promise<void> {
  try {
    await fsPromises.rename(srcPath, destPath);
  } catch (e) {
    // https://github.com/nodejs/node/issues/19077 :
    // rename uses hardlinks, fails cross-devices: marked 'wontfix'
    if ((await fsPromises.stat(srcPath)).isDirectory()) {
      // https://github.com/jprichardson/node-fs-extra/blob/HEAD/docs/copy.md
      // "Note that if src is a directory it will copy everything inside of this directory, not the entire directory itself"
      // https://github.com/jprichardson/node-fs-extra/issues/537
      // This is exactly what we want.

      await fsExtra.copy(srcPath, destPath);
      await fsPromises.rm(srcPath, {
        recursive: true, force: true, maxRetries: 2
      });
    } else {
      await fsPromises.copyFile(srcPath, destPath);
      await fsPromises.unlink(srcPath);
    }
  }
}
