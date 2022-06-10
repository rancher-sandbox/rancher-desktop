/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'child_process';
import { createRequire } from 'module';
import os from 'os';
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
    return process.argv.includes('--serial');
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
          {
            test: /(?:^|[/\\])assets[/\\]scripts[/\\]/,
            use:  { loader: 'raw-loader' },
          },
        ],
      },
      plugins: [
        new webpack.EnvironmentPlugin({ NODE_ENV: process.env.NODE_ENV || 'production' }),
      ],
    };
  },

  /**
   * Build the main process JavaScript code.
   * @returns {Promise<void>}
   */
  buildJavaScript() {
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

  /** Mapping from the platform name to the GOOS value. */
  goOSMapping: {
    darwin: 'darwin',
    linux:  'linux',
    win32:  'windows',
  },

  /**
   * Build the WSL helper application for Windows.
   * @returns {Promise<void>};
   */
  async buildWSLHelper() {
    /**
     * Build for a single platform
     * @param {"linux" | "win32"} platform The platform to build for.
     */
    const buildPlatform = async(platform) => {
      const exeName = platform === 'win32' ? 'wsl-helper.exe' : 'wsl-helper';
      const outFile = path.join(this.srcDir, 'resources', platform, exeName);

      await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
        cwd: path.join(this.srcDir, 'src', 'go', 'wsl-helper'),
        env: {
          ...process.env,
          GOOS:        this.goOSMapping[platform],
          CGO_ENABLED: '0',
        }
      });
    };

    await this.wait(
      buildPlatform.bind(this, 'linux'),
      buildPlatform.bind(this, 'win32'),
    );
  },

  /**
   * Build the nerdctl stub.
   * @param os {"windows" | "linux"}
   */
  async buildNerdctlStub(os) {
    if (!['windows', 'linux'].includes(os)) {
      throw new Error(`Unexpected os of ${ os }`);
    }
    let platDir, parentDir, outFile;

    if (os === 'windows') {
      platDir = 'win32';
      parentDir = path.join(this.srcDir, 'resources', platDir, 'bin');
      outFile = path.join(parentDir, 'nerdctl.exe');
    } else {
      platDir = 'linux';
      parentDir = path.join(this.srcDir, 'resources', platDir, 'bin');
      // nerdctl-stub is the actual nerdctl binary to be run on linux;
      // there is also a `nerdctl` wrapper in the same directory to make it
      // easier to handle permissions for Linux-in-WSL.
      outFile = path.join(parentDir, 'nerdctl-stub');
    }
    // The linux build produces both nerdctl-stub and nerdctl
    await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
      cwd: path.join(this.srcDir, 'src', 'go', 'nerdctl-stub'),
      env: {
        ...process.env,
        GOOS: os,
      }
    });
  },

  /**
   * Build a utility for the current OS
   */
  async buildUtility(name, platform) {
    const target = platform === 'win32' ? `${ name }.exe` : name;
    const parentDir = path.join(this.srcDir, 'resources', platform, 'bin');
    const outFile = path.join(parentDir, target);

    await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
      cwd: path.join(this.srcDir, 'src', 'go', name),
      env: {
        ...process.env,
        GOOS: this.goOSMapping[platform],
      }
    });
  },

  /**
   * Build the vtunnel.
   */
  async buildVtunnel(platform) {
    const target = platform === 'win32' ? 'vtunnel.exe' : 'vtunnel';
    const parentDir = path.join(this.srcDir, 'resources', platform, 'internal');
    const outFile = path.join(parentDir, target);

    await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
      cwd: path.join(this.srcDir, 'src', 'go', 'vtunnel'),
      env: {
        ...process.env,
        GOOS: this.goOSMapping[platform],
      }
    });
  },

  /**
   * Build the main process code.
   * @returns {Promise<void>}
   */
  buildMain() {
    const tasks = [() => this.buildJavaScript()];

    if (os.platform().startsWith('win')) {
      tasks.push(() => this.buildWSLHelper());
      tasks.push(() => this.buildNerdctlStub('windows'));
      tasks.push(() => this.buildNerdctlStub('linux'));
      tasks.push(() => this.buildVtunnel('win32'));
      tasks.push(() => this.buildVtunnel('linux'));
    }
    tasks.push(() => this.buildUtility('rdctl', os.platform()));
    tasks.push(() => this.buildUtility('docker-credential-none', os.platform()));

    return this.wait(...tasks);
  },

};
