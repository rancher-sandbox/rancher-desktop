/**
 * This script builds the distributable packages.
 */

'use strict';

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import childProcess from 'child_process';
import buildUtils from './lib/build-utils.mjs';

class Builder {
  async cleanup() {
    console.log('Removing previous builds...');
    const dirs = [
      path.resolve(buildUtils.rendererSrcDir, 'dist'),
      path.resolve(buildUtils.distDir),
    ];
    const options = {
      force: true, maxRetries: 3, recursive: true
    };

    await Promise.all(dirs.map(dir => fs.rm(dir, options)));

    if (/^win/i.test(os.platform())) {
      // On Windows, virus scanners (e.g. the default Windows Defender) like to
      // hold files open upon deletion(!?) and delay the deletion for a second
      // or two.  Wait for those directories to actually be gone before
      // continuing.
      const waitForDelete = async(dir) => {
        while (true) {
          try {
            await fs.stat(dir);
            await buildUtils.sleep(500);
          } catch (e) {
            if (e?.code === 'ENOENT') {
              return;
            }
            throw e;
          }
        }
      };

      await Promise.all(dirs.map(waitForDelete));
    }
  }

  async buildRenderer() {
    const nuxtBin = 'node_modules/nuxt/bin/nuxt.js';
    const nuxtOutDir = path.join(buildUtils.rendererSrcDir, 'dist');

    await buildUtils.spawn('node', nuxtBin, 'build', buildUtils.rendererSrcDir);
    await buildUtils.spawn('node', nuxtBin, 'generate', buildUtils.rendererSrcDir);
    await fs.rename(nuxtOutDir, buildUtils.appDir);
  }

  async build() {
    console.log('Building...');
    await this.buildRenderer();
    await buildUtils.buildMain();
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

    args.push(`-c.extraMetadata.version=${ finalBuildVersion }`);
    await buildUtils.spawn('node', 'node_modules/electron-builder/out/cli/cli.js', ...args, { env });
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
