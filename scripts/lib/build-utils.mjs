/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import url from 'url';
import util from 'util';
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

  sleep: util.promisify(setTimeout),

  /**
   * Get the root directory of the repository.
   */
  get srcDir() {
    return path.resolve(url.fileURLToPath(import.meta.url), '..', '..', '..');
  },

  get rendererSrcDir() {
    return path.resolve(this.srcDir, 'src');
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

  _require: createRequire(import.meta.url),
  require(pkgPath) {
    return this._require(path.resolve(this.srcDir, pkgPath));
  },

  /** The package.json metadata. */
  get packageMeta() {
    return this.require('package.json');
  },

  get babelConfig() {
    return this.require('babel.config');
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
      entry:     { background: path.resolve(this.srcDir, 'background') },
      externals: [...Object.keys(this.packageMeta.dependencies)],
      devtool:   this.isDevelopment ? 'source-map' : false,
      resolve:   {
        alias:      { '@': path.resolve(this.srcDir, 'src') },
        extensions: ['.ts', '.js', '.json'],
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
            test: /\.ts$/,
            use:  { loader: 'ts-loader' }
          },
          {
            test: /\.js$/,
            use:  {
              loader:  'babel-loader',
              options: {
                ...this.babelConfig,
                cacheDirectory: true,
              },
            },
            exclude: [/node_modules/, this.distDir],
          },
          {
            test: /\.ya?ml$/,
            use:  { loader: 'js-yaml-loader' },
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
