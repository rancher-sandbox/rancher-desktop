/**
 * This script runs the application for development.
 */

'use strict';

// We use a custom script instead of `nuxtron dev` so that the application will
// exit when the electron part is done; the normal nuxtron behaviour is that
// the renderer persists and will re-launch electron when the main process
// changes.

import childProcess from 'child_process';
import events from 'events';
import path from 'path';
import url from 'url';
import { createRequire } from 'module';
import webpack from 'webpack';
import merge from 'webpack-merge';

class DevRunner extends events.EventEmitter {
  emitError(message, error) {
    let combinedMessage = message;
    if (error?.message) {
      combinedMessage += `: ${error.message}`;
    }
    const newError = new Error(combinedMessage);
    newError.code = error?.code;
    if (error?.stack) {
      newError.stack += `\nCaused by: ${error.stack}`;
    }
    this.emit('error', newError);
  }

  exiting = false;

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

  /** @returns {webpack.Configuration} */
  get defaultWebpackConfig() {
    const require = createRequire(import.meta.url);
    const externals = require(path.resolve(this.srcDir, 'package.json')).dependencies;
    return {
      mode:   'development',
      target: 'electron-main',
      node:   {
        __dirname:  false,
        __filename: false,
      },
      externals: [...Object.keys(externals)],
      devtool:   'source-map',
      resolve:   {
        extensions: ['.js', '.json'],
        modules:    [path.resolve(this.srcDir, 'app'), 'node_modules'],
      },
      output: {
        libraryTarget: 'commonjs2',
      },
      module: {
        rules: [
          {
            test: /\.(js|ts)$/,
            use:  {
              loader:  'babel-loader',
              options: {
                cacheDirectory: true,
                // This matches nuxtron defaults, we'll override in nuxtron.config.
                presets:        ['@babel/preset-typescript'],
              },
            },
            exclude: [
              /node_modules/,
            ],
          },
        ],
      },
      plugins: [
        new webpack.EnvironmentPlugin({ NODE_ENV: 'development' }),
      ],
    };
  }

  /** @type webpack.Configuration */
  #webpackConfig = null;
  get webpackConfig() {
    if (!this.#webpackConfig) {
      const config = merge(this.defaultWebpackConfig, {
        entry: {
          background: path.resolve(this.srcDir, 'background.js'),
        },
        output: {
          filename: '[name].js',
          path:     path.resolve(this.srcDir, 'app'),
        },
      });
      this.#webpackConfig = this.nuxtronConfig.webpack(config, 'development');
    }
    return this.#webpackConfig;
  }

  #rendererSrcDir = null;
  get rendererSrcDir() {
    if (!this.#rendererSrcDir) {
      this.#rendererSrcDir = path.resolve(this.srcDir, this.nuxtronConfig.rendererSrcDir);
    }
    return this.#rendererSrcDir;
  }

  get rendererPort() { return 8888; }

  /**
   * Spawn a child process, set up to emit errors on unexpected exit.
   * @param {string} title The title of the process to show in messages.
   * @param {string} command The executable to run.
   * @param  {...string} args Any arguments to the executable.
   * @returns {childProcess.ChildProcess} The new child process.
   */
  spawn(title, command, ...args) {
    const options = {
      cwd:   this.srcDir,
      stdio: 'inherit',
    };
    const errorTitle = `${title} error`;
    const child = childProcess.spawn(command, args, options);
    child.on('exit', (code, signal) => {
      if (signal && signal !== 'SIGTERM') {
        this.emitError(errorTitle, new Error(`Process exited with signal ${signal}`));
      } else if (code > 0) {
        this.emitError(errorTitle, new Error(`Process exited with code ${code}`));
      }
    });
    child.on('error', error => {
      this.emitError(errorTitle, error);
    });
    child.on('close', () => this.exit());
    return child;
  }

  /** @type childProcess.ChildProcess? */
  #mainProcess = null;
  async startMainProcess() {
    if (this.#mainProcess && this.#mainProcess.exitCode === null) {
      return this.#mainProcess;
    }
    return await new Promise((resolve, reject) => {
      webpack(this.webpackConfig).run((err, stats) => {
        if (err) {
          reject(err);
          return;
        }
        if (stats.hasErrors()) {
          reject(stats.toString({ colors: true, errorDetails: true }));
          return;
        }
        console.log(stats.toString({ colors: true }));
        const process = this.spawn('Main process',
          'electron', this.srcDir, this.rendererPort);
        this.#mainProcess = process;
        resolve(this.#mainProcess);
      });
    });
  }

  /** @type childProcess.ChildProcess? */
  #rendererProcess = null;
  startRendererProcess() {
    if (this.#rendererProcess && this.#rendererProcess.exitCode === null) {
      return this.#rendererProcess;
    }
    const process = this.spawn('Renderer process',
      'nuxt', '--port', this.rendererPort, this.rendererSrcDir);
    this.#rendererProcess = process;
    return this.#rendererProcess;
  }

  exit() {
    this.exiting = true;
    this.#rendererProcess?.kill();
    this.#mainProcess?.kill();
  }

  async run() {
    try {
      this.startRendererProcess();
      await this.startMainProcess();
      await new Promise((resolve, reject) => {
        this.on('error', reject);
      });
    } finally {
      this.exit();
    }
  }
}

(new DevRunner()).run().catch(e => {
  console.error(e);
  process.exit(1);
});
