/**
 * This script builds the distributable packages. It assumes that we have _just_
 * built the JavaScript parts.
 */

'use strict';

import childProcess from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

import buildInstaller from './lib/installer-win32';

import { spawnFile } from '@pkg/utils/childProcess';

/** Get the argument value (if any) for any of the given argument names */
function getArgValue(args: string[], ...argNames: string[]): string | undefined {
  for (const [i, arg] of args.entries()) {
    const lowerArg = arg.toLowerCase();

    for (const argName of argNames) {
      if (argName === lowerArg && i < args.length - 1) {
        return args[i + 1];
      }
      if (argName.startsWith('--')) {
        // long arg, "--variable=foo"
        if (lowerArg.startsWith(`${ argName }=`)) {
          return lowerArg.substring(argName.length + 1);
        }
      } else if (lowerArg.startsWith(argName)) {
        // short arg, "-vfoo"
        return lowerArg.substring(argName.length);
      }
    }
  }
}

class Builder {
  async replaceInFile(srcFile: string, pattern: string | RegExp, replacement: string, dstFile?: string) {
    dstFile = dstFile || srcFile;
    await fs.stat(srcFile);
    const data = await fs.readFile(srcFile, 'utf8');

    await fs.writeFile(dstFile, data.replace(pattern, replacement));
  }

  async package() {
    console.log('Packaging...');
    const args = process.argv.slice(2).filter(x => x !== '--serial');
    // On Windows, electron-builder will run the installer to generate the
    // uninstall stub; however, we set the installer to be elevated, in order
    // to ensure that we can install WSL if necessary.  To make it possible to
    // build the installer as a non-administrator, we need to set the special
    // environment variable `__COMPAT_LAYER=RunAsInvoker` to force the installer
    // to run as the existing user.
    const env = { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' };
    const fullBuildVersion = childProcess.execFileSync('git', ['describe', '--tags']).toString().trim();
    const finalBuildVersion = fullBuildVersion.replace(/^v/, '');
    const appData = 'packaging/linux/rancher-desktop.appdata.xml';
    const release = `<release version="${ finalBuildVersion }" date="${ new Date().toISOString() }"/>`;

    await this.replaceInFile(appData, /<release.*\/>/g, release, appData.replace('packaging', 'resources'));
    args.push(`-c.extraMetadata.version=${ finalBuildVersion }`);
    await spawnFile('node', ['node_modules/electron-builder/out/cli/cli.js', ...args], { stdio: 'inherit', env });

    if (process.platform === 'win32') {
      const distDir = path.join(process.cwd(), 'dist');
      const appDir = path.join(distDir, 'win-unpacked');
      const targetList = getArgValue(args, '-w', '--win', '--windows');

      if (targetList !== 'zip') {
        // Only build installer if we're not asked not to.
        await buildInstaller(distDir, appDir);
      }
    }
  }

  async run() {
    await this.package();
  }
}

(new Builder()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});
