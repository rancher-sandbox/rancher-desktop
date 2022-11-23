/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import webpack from 'webpack';

import babelConfig from 'babel.config';

/**
 * A promise that is resolved when the child exits.
 */
type SpawnResult = Promise<void> & {
  child: childProcess.ChildProcess;
};

export default {
  /**
   * Determine if we are building for a development build.
   */
  get isDevelopment() {
    return /^(?:dev|test)/.test(process.env.NODE_ENV ?? '');
  },

  get serial() {
    return process.argv.includes('--serial');
  },

  sleep: util.promisify(setTimeout),

  /**
   * Get the root directory of the repository.
   */
  get rootDir() {
    return path.resolve(__dirname, '..', '..');
  },

  get rendererSrcDir() {
    return path.resolve(this.rootDir, `${ process.env.RD_ENV_PLUGINS_DEV ? '' : 'pkg/rancher-desktop' }`);
  },

  /**
   * Get the directory where all of the build artifacts should reside.
   */
  get distDir() {
    return path.resolve(this.rootDir, 'dist');
  },

  /**
   * Get the directory holding the generated files.
   */
  get appDir() {
    return path.resolve(this.distDir, 'app');
  },

  /** The package.json metadata. */
  get packageMeta() {
    const raw = fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf-8');

    return JSON.parse(raw);
  },

  /**
  * Spawn a new process, returning the child process.
  * @param command The executable to spawn.
  * @param args Arguments to the executable. The last argument may be
  *                        an Object holding options for child_process.spawn().
  */
  spawn(command: string, ...args: any[]): SpawnResult {
    const options: childProcess.SpawnOptions = {
      cwd:   this.rootDir,
      stdio: 'inherit',
    };

    if (args.concat().pop() instanceof Object) {
      Object.assign(options, args.pop());
    }
    const child = childProcess.spawn(command, args, options);
    const promise: Promise<void> = new Promise((resolve, reject) => {
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

    return Object.assign(promise, { child });
  },

  /**
   * Execute the passed-in array of tasks and wait for them to finish.  By
   * default, all tasks are executed in parallel.  The user may pass `--serial`
   * on the command line to causes the tasks to be executed serially instead.
   * @param tasks Tasks to execute.
   */
  async wait(...tasks: (() => Promise<void>)[]) {
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
   */
  get webpackConfig(): webpack.Configuration {
    const mode = this.isDevelopment ? 'development' : 'production';

    return {
      mode,
      target: 'electron-main',
      node:   {
        __dirname:  false,
        __filename: false,
      },
      entry:     { background: path.resolve(this.rootDir, 'background') },
      externals: [...Object.keys(this.packageMeta.dependencies)],
      devtool:   this.isDevelopment ? 'source-map' : false,
      resolve:   {
        alias:      { '@pkg': path.resolve(this.rootDir, 'pkg', 'rancher-desktop') },
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
            use:  { loader: 'ts-loader' },
          },
          {
            test: /\.js$/,
            use:  {
              loader:  'babel-loader',
              options: {
                ...babelConfig,
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
   */
  buildJavaScript(): Promise<void> {
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

  /** Mapping from the platform name to the Go OS value. */
  mapPlatformToGoOS(platform: NodeJS.Platform) {
    switch (platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      throw new Error(`Invalid platform "${ platform }"`);
    }
  },

  /**
   * Build the WSL helper application for Windows.
   */
  async buildWSLHelper(): Promise<void> {
    /**
     * Build for a single platform
     * @param platform The platform to build for.
     */
    const buildPlatform = async(platform: 'linux' | 'win32') => {
      const exeName = platform === 'win32' ? 'wsl-helper.exe' : 'wsl-helper';
      const outFile = path.join(this.rootDir, 'resources', platform, exeName);

      await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
        cwd: path.join(this.rootDir, 'src', 'go', 'wsl-helper'),
        env: {
          ...process.env,
          GOOS:        this.mapPlatformToGoOS(platform),
          CGO_ENABLED: '0',
        },
      });
    };

    await this.wait(
      buildPlatform.bind(this, 'linux'),
      buildPlatform.bind(this, 'win32'),
    );
  },

  /**
   * Build the nerdctl stub.
   */
  async buildNerdctlStub(os: 'windows' | 'linux'): Promise<void> {
    let platDir, parentDir, outFile;

    if (os === 'windows') {
      platDir = 'win32';
      parentDir = path.join(this.rootDir, 'resources', platDir, 'bin');
      outFile = path.join(parentDir, 'nerdctl.exe');
    } else {
      platDir = 'linux';
      parentDir = path.join(this.rootDir, 'resources', platDir, 'bin');
      // nerdctl-stub is the actual nerdctl binary to be run on linux;
      // there is also a `nerdctl` wrapper in the same directory to make it
      // easier to handle permissions for Linux-in-WSL.
      outFile = path.join(parentDir, 'nerdctl-stub');
    }
    // The linux build produces both nerdctl-stub and nerdctl
    await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
      cwd: path.join(this.rootDir, 'src', 'go', 'nerdctl-stub'),
      env: {
        ...process.env,
        GOOS: os,
      },
    });
  },

  /**
   * Build a golang-based utility for the specified platform.
   * @param name basename of the executable to build
   * @param platform 'linux', 'windows', or 'darwin'
   * @param childDir final folder destination either 'internal' or 'bin'
   */
  async buildUtility(name: string, platform: NodeJS.Platform, childDir: string): Promise<void> {
    const target = platform === 'win32' ? `${ name }.exe` : name;
    const parentDir = path.join(this.rootDir, 'resources', platform, childDir);
    const outFile = path.join(parentDir, target);

    await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', outFile, '.', {
      cwd: path.join(this.rootDir, 'src', 'go', name),
      env: {
        ...process.env,
        GOOS: this.mapPlatformToGoOS(platform),
      },
    });
  },

  /**
   * Build the main process code.
   */
  buildMain(): Promise<void> {
    const tasks = [() => this.buildJavaScript()];

    if (os.platform().startsWith('win')) {
      tasks.push(() => this.buildWSLHelper());
      tasks.push(() => this.buildNerdctlStub('windows'));
      tasks.push(() => this.buildNerdctlStub('linux'));
      tasks.push(() => this.buildUtility('vtunnel', 'linux', 'internal'));
      tasks.push(() => this.buildUtility('vtunnel', 'win32', 'internal'));
      tasks.push(() => this.buildUtility('rdctl', 'linux', 'bin'));
      tasks.push(() => this.buildUtility('privileged-service', 'win32', 'internal'));
    }
    tasks.push(() => this.buildUtility('rdctl', os.platform(), 'bin'));
    tasks.push(() => this.buildUtility('docker-credential-none', os.platform(), 'bin'));

    return this.wait(...tasks);
  },

};
