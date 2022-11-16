// This script builds the wix installer, assuming the zip file has already been
// built (and dist/win-unpacked is populated).
// This is only used during development.

import path from 'path';

import buildInstaller from './lib/installer-win32';

async function run() {
  const distDir = path.join(process.cwd(), 'dist');
  const appDir = path.join(distDir, 'win-unpacked');

  await buildInstaller(distDir, appDir);
}

run().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
