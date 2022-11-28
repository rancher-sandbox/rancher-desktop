/**
 * This script builds the distributable packages.
 */

'use strict';

import childProcess from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import buildUtils from './lib/build-utils';
import buildInstaller from './lib/installer-win32';

import { spawnFile } from '@pkg/utils/childProcess';

class Builder {
  async cleanup() {
    console.log('Removing previous builds...');
    const dirs = [
      path.resolve(buildUtils.rendererSrcDir, 'dist'),
      path.resolve(buildUtils.distDir),
    ];
    const options = {
      force: true, maxRetries: 3, recursive: true,
    };

    await Promise.all(dirs.map(dir => fs.rm(dir, options)));

    if (/^win/i.test(os.platform())) {
      // On Windows, virus scanners (e.g. the default Windows Defender) like to
      // hold files open upon deletion(!?) and delay the deletion for a second
      // or two.  Wait for those directories to actually be gone before
      // continuing.
      const waitForDelete = async(dir: string) => {
        while (true) {
          try {
            await fs.stat(dir);
            await buildUtils.sleep(500);
          } catch (error: any) {
            if (error?.code === 'ENOENT') {
              return;
            }
            throw error;
          }
        }
      };

      await Promise.all(dirs.map(waitForDelete));
    }
  }

  async buildRenderer() {
    const nuxtBin = 'node_modules/nuxt/bin/nuxt.js';
    const nuxtOutDir = path.join(buildUtils.rendererSrcDir, 'dist');

    await spawnFile('node', [nuxtBin, 'build', buildUtils.rendererSrcDir], { stdio: 'inherit' });
    await spawnFile('node', [nuxtBin, 'generate', buildUtils.rendererSrcDir], { stdio: 'inherit' });
    await fs.rename(nuxtOutDir, buildUtils.appDir);
  }

  async build() {
    console.log('Building...');
    await this.buildRenderer();
    await buildUtils.buildMain();
  }

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

      await buildInstaller(distDir, appDir);
    }
  }

  async run() {
    await this.cleanup();
    await this.build();
    await this.package();
  }
}

(new Builder()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});
