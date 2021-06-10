'use strict';

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

/**
 * Download the given URL, making the result executable
 * @param url {string} The URL to download
 * @param destPath {string} The path to download to
 * @param overwrite {boolean} Whether to re-download files that already exist.
 * @param access {number} The file mode required.
 */
export default async function download(url, destPath, overwrite = false, access = fs.constants.X_OK) {
  if (!overwrite) {
    try {
      await fs.promises.access(destPath, access);
      console.log(`${ destPath } already exists, not re-downloading.`);

      return;
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }
  console.log(`Downloading ${ url } to ${ destPath }...`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error downloading ${ url }: ${ response.statusText }`);
  }
  const tempPath = `${ destPath }.download`;

  try {
    const file = fs.createWriteStream(tempPath);
    const promise = new Promise(resolve => file.on('finish', resolve));

    response.body.pipe(file);
    await promise;
    const mode =
      (access & fs.constants.X_OK) ? 0o755 : (access & fs.constants.W_OK) ? 0o644 : 0o444;

    await fs.promises.chmod(tempPath, mode);
    await fs.promises.rename(tempPath, destPath);
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        console.error(ex);
      }
    }
  }
}
