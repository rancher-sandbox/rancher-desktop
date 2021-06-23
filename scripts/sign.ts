/**
 * This script signs existing builds.
 *
 * Usage: npm run sign -- blahblah.zip
 *
 * Currently, only Windows is supported; mac support is planned.
 * Please remember to set CSC_LINK and CSC_KEY_PASSWORD as appropriate.
 * See https://www.electron.build/code-signing for details.
 */

import fs from 'fs';
import path from 'path';

import extract from 'extract-zip';
import { CustomWindowsSignTaskConfiguration } from 'app-builder-lib';
import { WinPackager } from 'app-builder-lib/out/winPackager';
import { doSign as doSignWindows } from 'app-builder-lib/out/codeSign/windowsCodeSign';

import * as childProcess from '../src/utils/childProcess';

async function signArchive(archive: string) {
  const distDir = path.join(process.cwd(), 'dist');

  await fs.promises.mkdir(distDir, { recursive: true });
  const workDir = await fs.promises.mkdtemp(path.join(distDir, 'sign-'));
  const archiveDir = path.join(workDir, 'unpacked');

  try {
    // Extract the archive
    console.log(`Extracting ${ archive } to ${ archiveDir }...`);
    await fs.promises.mkdir(archiveDir, { recursive: true });
    await extract(archive, { dir: archiveDir });

    // Detect the archive type
    for (const file of await fs.promises.readdir(archiveDir)) {
      if (file.endsWith('.exe')) {
        await signWindows(workDir);

        return;
      }
    }
  } finally {
    await fs.promises.rm(workDir, { recursive: true, maxRetries: 3 });
  }
}

async function signWindows(workDir: string) {
  await childProcess.spawnFile(
    process.argv0,
    [
      'node_modules/ts-node/dist/bin.js',
      '--compiler-options', '{"module": "commonjs"}',
      'node_modules/electron-builder/out/cli/cli.js',
      'build', '--prepackaged', path.join(workDir, 'unpacked'),
      '--config.win.sign', __filename,
    ],
    {
      stdio: 'inherit',
      env:   {
        ...process.env,
        __COMPAT_LAYER: 'RunAsInvoker',
        RD_SIGN_MODE:   'windows',
        RD_WORK_DIR:    workDir,
      }
    });
}

/**
 * This function gets called instead of the normal doSign(); we use this as an
 * oppurtunity to sign the actual executable, then call the original function to
 * handle the rest of the signing.
 */
async function windowsHook(configuration: CustomWindowsSignTaskConfiguration, packager: WinPackager): Promise<void> {
  // We will initially be asked to sign "elevate.exe" inside the work dir; we
  // will take that oppurtunity to also sign the main executable.  There's no
  // point re-signing that executable when dealing with the installer & the
  // uninstaller stub.
  const workDir = process.env.RD_WORK_DIR;

  if (workDir && !path.relative(workDir, configuration.path).startsWith('..')) {
    const unpackedDir = path.join(workDir, 'unpacked');

    for (const filename of await fs.promises.readdir(unpackedDir)) {
      if (path.extname(filename) === '.exe') {
        const filepath = path.join(unpackedDir, filename);

        console.log(`      Signing extra file: ${ filepath }`);
        // Unfortunately, configuration.computeSignToolArgs is a function that's
        // already curried to have a bound configuration; this means that we
        // can't just modify the path in the configuration and have it sign the
        // new file.  Instead, we must call it and then modify the result (a
        // command line to be executed) to refer to the new file to sign instead.
        const mutatedConfiguration: CustomWindowsSignTaskConfiguration = {
          ...configuration,
          path:                filepath,
          computeSignToolArgs: (isWin: boolean) => {
            const result = configuration.computeSignToolArgs(isWin);

            return result.map(x => x === configuration.path ? filepath : x);
          }
        };

        await doSignWindows(mutatedConfiguration, packager);
      }
    }
  }
  await doSignWindows(configuration, packager);
}

switch (process.env.RD_SIGN_MODE) {
case 'windows':
  module.exports = windowsHook;
  break;
default:
  (async() => {
    try {
      for (const path of process.argv) {
        if (path.endsWith('.zip')) {
          await signArchive(path);
        }
      }
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  })();
}
