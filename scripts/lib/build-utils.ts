/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';
import zlib from 'zlib';

import _ from 'lodash';
import tar from 'tar-stream';
import webpack from 'webpack';

import { RecursivePartial } from '@pkg/utils/typeUtils';
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
   * WebPack configuration for the preload script
   */
  get webpackPreloadConfig(): webpack.Configuration {
    function isRuleSetLoader(i: webpack.RuleSetUseItem): i is webpack.RuleSetLoader {
      return typeof i === 'object';
    }

    const overrides: RecursivePartial<webpack.Configuration> = {
      target: 'electron-preload',
      output: { libraryTarget: 'var', path: path.join(this.rootDir, 'resources') },
    };
    const result = _.merge({}, this.webpackConfig, overrides);
    const rules = result.module?.rules ?? [];
    const uses = rules.flatMap((r) => {
      if (typeof r.use !== 'object') {
        return [];
      }

      return Array.isArray(r.use) ? r.use : [r.use];
    }).filter(isRuleSetLoader);
    const tsLoader = uses.find(u => u.loader === 'ts-loader');

    if (tsLoader) {
      tsLoader.options = _.merge({}, tsLoader.options, { compilerOptions: { noEmit: false } });
    }

    result.entry = { preload: path.resolve(this.rendererSrcDir, 'preload', 'index.ts') };

    return result;
  },

  /**
   * Build the main process JavaScript code.
   */
  buildJavaScript(config: webpack.Configuration): Promise<void> {
    return new Promise((resolve, reject) => {
      webpack(config).run((err, stats) => {
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

  mapArchToGoArch(arch: string) {
    const result = ({
      x64:   'amd64',
      arm64: 'arm64',
    } as const)[arch];

    if (!result) {
      throw new Error(`Architecture ${ arch } is not supported.`);
    }

    return result;
  },

  get arch(): string {
    return process.env.M1 ? 'arm64' : process.arch;
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

  async buildExtensionProxyImage(): Promise<void> {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-build-rdx-pf-'));

    try {
      const executablePath = path.join(workDir, 'extension-proxy');
      const layerPath = path.join(workDir, 'layer.tar');
      const imagePath = path.join(this.rootDir, 'resources', 'rdx-proxy.tgz');

      console.log('Building RDX proxying image...');

      // Build the golang executable
      await this.spawn('go', 'build', '-ldflags', '-s -w', '-o', executablePath, '.', {
        cwd: path.join(this.rootDir, 'src', 'go', 'extension-proxy'),
        env: {
          ...process.env,
          CGO_ENABLED: '0',
          GOOS:        'linux',
          GOARCH:      this.mapArchToGoArch(this.arch),
        },
      });

      // Build the layer tarball
      // tar streams don't implement piping to multiple writers, and stream.Duplex
      // can't deal with it either; so we need to fully write out the file, then
      // calculate the hash as a separate step.
      const layer = tar.pack();
      const layerOutput = layer.pipe(fs.createWriteStream(layerPath));
      const executableStats = await fs.promises.stat(executablePath);

      await stream.promises.finished(
        fs.createReadStream(executablePath)
          .pipe(layer.entry({
            name:  path.basename(executablePath),
            mode:  0o755,
            type:  'file',
            mtime: new Date(0),
            size:  executableStats.size,
          })));
      layer.finalize();
      await stream.promises.finished(layerOutput);

      // calculate the hash
      const layerReader = fs.createReadStream(layerPath);
      const layerHasher = layerReader.pipe(crypto.createHash('sha256'));

      await stream.promises.finished(layerReader);

      // Build the image tarball
      const layerHash = layerHasher.digest().toString('hex');
      const image = tar.pack();
      const imageWritten =
        stream.promises.finished(
          image
            .pipe(zlib.createGzip())
            .pipe(fs.createWriteStream(imagePath)));
      const addEntry = (name: string, input: Buffer | stream.Readable, size?: number) => {
        if (Buffer.isBuffer(input)) {
          size = input.length;
          input = stream.Readable.from(input);
        }

        return stream.promises.finished((input as stream.Readable).pipe(image.entry({
          name,
          size,
          type:  'file',
          mtime: new Date(0),
        })));
      };

      image.entry({ name: layerHash, type: 'directory' });
      await addEntry(`${ layerHash }/VERSION`, Buffer.from('1.0'));
      await addEntry(`${ layerHash }/layer.tar`, fs.createReadStream(layerPath), layerOutput.bytesWritten);
      await addEntry(`${ layerHash }/json`, Buffer.from(JSON.stringify({
        id:     layerHash,
        config: {
          ExposedPorts: { '80/tcp': {} },
          WorkingDir:   '/',
          Entrypoint:   [`/${ path.basename(executablePath) }`],
        },
      })));
      await addEntry(`${ layerHash }.json`, Buffer.from(JSON.stringify({
        architecture: this.mapArchToGoArch(this.arch),
        config:       {
          ExposedPorts: { '80/tcp': {} },
          Entrypoint:   [`/${ path.basename(executablePath) }`],
          WorkingDir:   '/',
        },
        history: [],
        os:      'linux',
        rootfs:  {
          type:     'layers',
          diff_ids: [`sha256:${ layerHash }`],
        },
      })));
      await addEntry('manifest.json', Buffer.from(JSON.stringify([
        {
          Config:   `${ layerHash }.json`,
          RepoTags: ['ghcr.io/rancher-sandbox/rancher-desktop/rdx-proxy:latest'],
          Layers:   [`${ layerHash }/layer.tar`],
        },
      ])));
      image.finalize();
      await imageWritten;
      console.log('Built RDX port proxy image');
    } finally {
      await fs.promises.rm(workDir, { recursive: true });
    }
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
   * Build the preload script.
   */
  async buildPreload(): Promise<void> {
    await this.buildJavaScript(this.webpackPreloadConfig);
  },

  /**
   * Build the main process code.
   */
  buildMain(): Promise<void> {
    return this.wait(() => this.buildJavaScript(this.webpackConfig));
  },

  /**
   * Build the things we build with go
   */
  async buildGoUtilities(): Promise<void> {
    const tasks = [];

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
    tasks.push(() => this.buildExtensionProxyImage());

    return this.wait(...tasks);
  },

};
