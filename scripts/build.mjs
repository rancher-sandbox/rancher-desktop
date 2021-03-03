/**
 * This script builds the distributable packages.
 */

'use strict';

import * as fs from 'fs/promises';
import * as path from 'path';
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
    await buildUtils.spawn('nuxt', 'build', buildUtils.rendererSrcDir);
    await buildUtils.spawn('nuxt', 'generate', buildUtils.rendererSrcDir);
    const nuxtOutDir = path.resolve(buildUtils.rendererSrcDir, 'dist');

    await buildUtils.copy(nuxtOutDir, buildUtils.appDir);
  }

  async build() {
    console.log('Building...');
    await buildUtils.wait(
      () => this.buildRenderer(),
      () => buildUtils.buildMain(),
      () => buildUtils.buildStratos(),
    );
  }

  async package() {
    console.log('Packaging...');
    const args = process.argv.slice(2).filter(x => x !== '--serial');

    await buildUtils.spawn('electron-builder', ...args);
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
