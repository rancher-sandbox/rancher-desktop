/**
 * This script builds the distributable packages.
 */

'use strict';

// We need to use a custom script because nuxtron doesn't support passing
// arguments such as --publish=never to electron-builder.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as url from 'url';
import { createRequire } from 'module';
import * as childProcess from 'child_process';

class Builder {
  #srcDir = null;
  get srcDir() {
    if (!this.#srcDir) {
      this.#srcDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    }

    return this.#srcDir;
  }

  #nuxtronConfig = null;
  get nuxtronConfig() {
    if (!this.#nuxtronConfig) {
      const require = createRequire(import.meta.url);

      this.#nuxtronConfig = require(path.resolve(this.srcDir, 'nuxtron.config'));
    }

    return this.#nuxtronConfig;
  }

  #rendererSrcDir = null;
  get rendererSrcDir() {
    if (!this.#rendererSrcDir) {
      this.#rendererSrcDir = path.resolve(this.srcDir, this.nuxtronConfig.rendererSrcDir);
    }

    return this.#rendererSrcDir;
  }

  async spawn(command, ...args) {
    const options = {
      cwd:   this.srcDir,
      stdio: 'inherit',
    };
    const child = childProcess.spawn(command, args, options);

    return await new Promise((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (signal) {
          reject(signal);
        } else if (code > 0) {
          reject(code);
        } else {
          resolve();
        }
      });
      child.on('error', reject);
    });
  }

  async cleanup() {
    console.log('Removing previous builds...');
    const dirs = [
      path.resolve(this.rendererSrcDir, 'dist'),
      path.resolve(this.srcDir, 'app'),
      path.resolve(this.srcDir, 'dist'),
    ];
    const options = {
      force: true, maxRetries: 3, recursive: true
    };

    await Promise.all(dirs.map(dir => fs.rm(dir, options)));
  }

  async buildRenderer() {
    await this.spawn('nuxt', 'build', this.rendererSrcDir);
    await this.spawn('nuxt', 'generate', this.rendererSrcDir);
    const nuxtOutDir = path.resolve(this.rendererSrcDir, 'dist');
    const electronInDir = path.resolve(this.srcDir, 'app');

    await fs.rename(nuxtOutDir, electronInDir);
  }

  async buildMain() {
    const script = path.resolve(this.srcDir, 'node_modules', 'nuxtron', 'bin', 'webpack', 'build.production.js');

    await this.spawn('node', script);
  }

  async build() {
    console.log('Building...');
    await this.buildRenderer();
    await this.buildMain();
  }

  async package() {
    console.log('Packaging...');
    const args = process.argv.slice(2);

    await this.spawn('electron-builder', ...args);
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
