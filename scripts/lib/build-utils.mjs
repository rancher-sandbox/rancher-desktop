/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'child_process';
import fs from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import url from 'url';
import webpack from 'webpack';

export default {
  /**
   * Determine if we are building for a development build.
   */
  get isDevelopment() {
    return /^(?:dev|test)/.test(process.env.NODE_ENV);
  },

  get serial() {
    return process.argv.some(x => x === '--serial');
  },

  /**
   * Get the root directory of the repository.
   */
  get srcDir() {
    return path.resolve(url.fileURLToPath(import.meta.url), '..', '..', '..');
  },

  get rendererSrcDir() {
    return path.resolve(this.srcDir, 'src');
  },

  get stratosSrcDir() {
    return path.resolve(this.srcDir, 'src', 'stratos');
  },

  get stratosJetstreamDir() {
    return path.resolve(this.stratosSrcDir, 'src', 'jetstream');
  },

  /**
   * Get the directory where all of the build artifacts should reside.
   */
  get distDir() {
    return path.resolve(this.srcDir, 'dist');
  },

  /**
   * Get the directory holding the generated files.
   */
  get appDir() {
    return path.resolve(this.distDir, 'app');
  },

  get stratosConfigDir() {
    return path.resolve(this.distDir, 'stratos');
  },

  /** The package.json metadata. */
  get packageMeta() {
    const require = createRequire(import.meta.url);

    return require(path.resolve(this.srcDir, 'package.json'));
  },

  /**
   * The version of electron we are building against.
   */
  get electronVersion() {
    return parseInt(/\d+/.exec(this.packageMeta.devDependencies.electron), 10);
  },

  /**
   * @typedef {Object} ObjectWithProcessChild - Any type holding a child process.
   * @property {childProcess.ChildProcess} child - The child process.
   *
   * @typedef {ObjectWithProcessChild & Promise<void>} SpawnResult
   *          A promise that is resolved when the child exits.
   */

  /**
  * Spawn a new process, returning the child process.
  * @param command {string} The executable to spawn.
  * @param args {string[]} Arguments to the executable. The last argument may be
  *                        an Object holding options for child_process.spawn().
  * @returns {SpawnResult} The resulting process.
  */
  spawn(command, ...args) {
    /** @type childProcess.SpawnOptions */
    const options = {
      cwd:   this.srcDir,
      stdio: 'inherit',
    };

    if (args.concat().pop() instanceof Object) {
      Object.assign(options, args.pop());
    }
    const child = childProcess.spawn(command, args, options);
    const result = new Promise((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (signal && signal !== 'SIGTERM') {
          reject(new Error(`Process exited with signal ${ signal }`));
        } else if (code !== 0 && code !== null) {
          reject(new Error(`Process exited with code ${ code }`));
        }
      });
      child.on('error', (error) => {
        reject(error);
      });
      child.on('close', resolve);
    });

    result.child = child;

    return result;
  },

  /**
   * Execute the passed-in array of tasks and wait for them to finish.  By
   * default, all tasks are executed in parallel.  The user may pass `--serial`
   * on the command line to causes the tasks to be executed serially instead.
   * @param  {...()=>Promise<void>} tasks Tasks to execute.
   */
  async wait(...tasks) {
    if (this.serial) {
      for (const task of tasks) {
        await task();
      }
    } else {
      await Promise.all(tasks.map(t => t()));
    }
  },

  /**
   * Get the webpack configuration for the main process.
   * @returns {webpack.Configuration}
   */
  get webpackConfig() {
    const mode = this.isDevelopment ? 'development' : 'production';

    return {
      mode,
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
        modules:    ['node_modules'],
      },
      output: {
        libraryTarget: 'commonjs2',
        filename:      '[name].js',
        path:          this.appDir,
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
            exclude: [/node_modules/, this.distDir],
          },
        ],
      },
      plugins: [
        new webpack.EnvironmentPlugin({ NODE_ENV: mode }),
      ],
    };
  },

  /**
   * Build the main process code.
   * @returns {Promise<void>}
   */
  buildMain() {
    return new Promise((resolve, reject) => {
      webpack(this.webpackConfig).run((err, stats) => {
        if (err) {
          return reject(err);
        }
        if (stats.hasErrors()) {
          return reject(new Error(stats.toString({ colors: true, errorDetails: true })));
        }
        console.log(stats.toString({ colors: true }));
        resolve();
      });
    });
  },

};
