// This script builds the wix installer, assuming the zip file has already been
// built (and dist/win-unpacked is populated).
// This is only used during development.

import fs from 'fs';
import path from 'path';

import buildInstaller from './lib/installer-win32';

async function run() {
  const distDir = path.join(process.cwd(), 'dist');
  const appDir = path.join(distDir, 'win-unpacked');

  try {
    await fs.promises.access(path.join(appDir, 'resources', 'app.asar'), fs.constants.R_OK);
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw ex;
    }
    console.error(`Could not find ${ appDir }, please run \`npm run build\` first.`);
    process.exit(1);
  }

  await buildInstaller(distDir, appDir);
}

run().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
