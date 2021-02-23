/**
 * This script builds the distributable packages.
 */

'use strict';

import events from 'events';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import { createRequire } from 'module';
import childProcess from 'child_process';
import webpack from 'webpack';

class BuildBase extends events.EventEmitter {
  #packageMeta = null;
  /** The package.json metadata. */
  get packageMeta() {
    if (this.#packageMeta) {
      return this.#packageMeta;
    }
    const require = createRequire(import.meta.url);

    this.#packageMeta = require(path.resolve(this.srcDir, 'package.json'));

    return this.#packageMeta;
  }

  get electronVersion() {
    return parseInt(/\d+/.exec(this.packageMeta.devDependencies.electron), 10);
  }

  isDevelopment = true;

  /** @type string */
  #srcDir = null;
  /** Path to the root of the repository checkout. */
  get srcDir() {
    if (!this.#srcDir) {
      this.#srcDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    }

    return this.#srcDir;
  }

  get outputDir() {
    return path.resolve(this.srcDir, 'dist', 'app');
  }

  /** @type webpack.Configuration */
  #webpackConfig = null;
  /** WebPack configuration for the main process. */
  get webpackConfig() {
    if (this.#webpackConfig) {
      return this.#webpackConfig;
    }

    this.#webpackConfig = {
      mode:   this.isDevelopment ? 'development' : 'production',
      target: 'electron-main',
      node:   {
        __dirname:  false,
        __filename: false,
      },
      entry:     { background: path.resolve(this.srcDir, 'background.js') },
      externals: [...Object.keys(this.packageMeta.dependencies)],
      devtool:   this.isDevelopment ? 'source-map' : false,
      resolve:   {
        alias:      { '@': path.resolve(this.srcDir, 'src') },
        extensions: ['.js', '.json'],
        modules:    [this.outputDir, 'node_modules'],
      },
      output: {
        libraryTarget: 'commonjs2',
        filename:      '[name].js',
        path:          this.outputDir,
      },
      module: {
        rules: [
          {
            test: /\.(js|ts)$/,
            use:  {
              loader:  'babel-loader',
              options: {
                cacheDirectory: true,
                presets:        [['@babel/preset-env',
                  { targets: { electron: this.electronVersion } }]
                ],
                plugins: ['@babel/plugin-proposal-private-methods'],
              },
            },
            exclude: [
              /node_modules/,
              path.resolve(this.srcDir, 'dist'),
            ],
          },
        ],
      },
      plugins: [
        new webpack.EnvironmentPlugin({ NODE_ENV: this.isDevelopment ? 'development' : 'production' }),
      ],
    };

    return this.#webpackConfig;
  }

  /** @type string */
  #rendererSrcDir = null;
  /** Path to the source directory of renderer code. */
  get rendererSrcDir() {
    if (!this.#rendererSrcDir) {
      this.#rendererSrcDir = path.resolve(this.srcDir, 'src');
    }

    return this.#rendererSrcDir;
  }

  /** Build the main process code. */
  async buildMain() {
    await new Promise((resolve, reject) => {
      webpack(this.webpackConfig).run((err, stats) => {
        if (err) {
          return reject(err);
        }
        if (stats.hasErrors()) {
          return reject(stats.toString({ colors: true, errorDetails: true }));
        }
        console.log(stats.toString({ colors: true }));
        resolve();
      });
    });
  }
}

class Builder extends BuildBase {
  /**
   * Execute a command, raising an exception if an error occurred.
   * @param command {string} The command to execute.
   * @param args {string[]} Arguments to the command.
   * @returns {Promise<void>} A promise that will complete when the command exits.
   */
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

  /** Remove previous builds. */
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

  /** Build the renderer package. */
  async buildRenderer() {
    await this.spawn('nuxt', 'build', this.rendererSrcDir);
    await this.spawn('nuxt', 'generate', this.rendererSrcDir);
    const nuxtOutDir = path.resolve(this.rendererSrcDir, 'dist');

    await fs.rename(nuxtOutDir, this.outputDir);
  }

  /** Build everything for packaging. */
  async build() {
    console.log('Building...');
    await this.buildRenderer();
    await this.buildMain();
  }

  /** Package the application for distribution. */
  async package() {
    console.log('Packaging...');
    await this.spawn('electron-builder', ...process.argv);
  }

  async run() {
    this.isDevelopment = false;
    await this.cleanup();
    await this.build();
    await this.package();
  }
}

class DevRunner extends BuildBase {
  emitError(message, error) {
    let combinedMessage = message;

    if (error?.message) {
      combinedMessage += `: ${ error.message }`;
    }
    const newError = new Error(combinedMessage);

    newError.code = error?.code;
    if (error?.stack) {
      newError.stack += `\nCaused by: ${ error.stack }`;
    }
    this.emit('error', newError);
  }

  exiting = false;

  /** The renderer port to use during development. */
  get rendererPort() {
    return 8888;
  }

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
    const errorTitle = `${ title } error`;
    const child = childProcess.spawn(command, args, options);

    child.on('exit', (code, signal) => {
      if (signal && signal !== 'SIGTERM') {
        this.emitError(errorTitle, new Error(`Process exited with signal ${ signal }`));
      } else if (code > 0) {
        this.emitError(errorTitle, new Error(`Process exited with code ${ code }`));
      }
    });
    child.on('error', (error) => {
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

    await this.buildMain();
    this.#mainProcess = this.spawn('Main process',
      'electron', this.srcDir, this.rendererPort);

    return this.#mainProcess;
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

process.argv.shift(); // node executable
const scriptName = process.argv.shift();

switch (process.argv.shift()) {
case 'build':
  (new Builder()).run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
  break;
case 'dev':
  (new DevRunner()).run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
  break;
default:
  console.error(`Unexpected arguments; usage: ${ scriptName } <build|dev>`);
}
