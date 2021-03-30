/**
 * This script builds the distributable packages.
 */

'use strict';

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
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
  }

  async buildRenderer() {
    const nuxtBin = 'node_modules/nuxt/bin/nuxt.js';

    await buildUtils.spawn('node', nuxtBin, 'build', buildUtils.rendererSrcDir);
    await buildUtils.spawn('node', nuxtBin, 'generate', buildUtils.rendererSrcDir);
    const nuxtOutDir = path.resolve(buildUtils.rendererSrcDir, 'dist');

    // On Windows, processes might return before writing files out properly
    // (possibly because of virus scanners).  Wait until it exists.
    while (/^win/i.test(os.platform())) {
      try {
        await fs.stat(nuxtOutDir);
        break;
      } catch (e) {
        if (e?.code !== 'ENOENT') {
          break;
        }
        await buildUtils.sleep(500);
      }
    }

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

    await buildUtils.spawn('node', 'node_modules/electron-builder/out/cli/cli.js', ...args);
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
