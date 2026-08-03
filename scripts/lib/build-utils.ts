/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import util from 'util';

import spawn from 'cross-spawn';
import _ from 'lodash';
import semver from 'semver';
import webpack from 'webpack';

import babelConfig from '@/babel.config.cjs';
import packageJson from '@/package.json' with { type: 'json' };

/**
 * Determine whether a specifier is likely to be resolvable at run time.  This
 * also catches missing files; however, it is possible that it may allow imports
 * that Node will reject at run time.
 */
function canResolve(specifier: string): boolean {
  try {
    // Because a `package.json` can declare conditional imports [1] that vary
    // between `import` and `require`, we must use `import.meta.resolve` to do the
    // resolution instead of `require.resolve`.  However, `import.meta.resolve`
    // only determines the path, not whether the file exists; we therefore must
    // also do a `stat` to make sure that is valid.
    // [1]: https://nodejs.org/api/packages.html#conditional-exports
    return fs.statSync(fileURLToPath(import.meta.resolve(specifier))).isFile();
  } catch {
    return false;
  }
}

/**
 * Spell out the file a subpath import refers to, because Node's ESM loader does
 * not do extension resolution.  Packages that publish an `exports` map resolve
 * their own subpaths, so try the request unchanged as well.  A request that
 * resolves no way at all would fail once packaged, so fail the build instead.
 */
function externalSpecifier(request: string): string {
  const candidates = [`${ request }.js`, request];
  const resolved = candidates.find(canResolve);

  if (!resolved) {
    throw new Error(`Cannot resolve external "${ request }"; Node will not resolve it at runtime either.`);
  }

  return resolved;
}

/**
 * externalsEntry returns a function for webpack's `externals` configuration [1]
 * to avoid bundling our listed dependencies.  This is needed as we sometimes
 * import files by reaching into the package directly, instead of simply
 * importing the top-level entry point, likely because the desired exports are
 * not available at the top level; for example, `electron-updater/out/MacUpdater`.
 * Bundling those dependencies causes issues as it is done via static analysis,
 * and `electron-updater` does `require('fs-extra')` which produces dynamic
 * exports that could not be detected via that static analysis.
 *
 * @param dependencies The npm packages to avoid bundling.
 *
 * [1]: https://webpack.js.org/configuration/externals/#function
 */
function externalsEntry(dependencies: Set<string>) {
  return ({ request }: webpack.ExternalItemFunctionData, callback: (error?: null, result?: webpack.ExternalItemValue) => void) => {
    const packageName = /^(?:@[^/]+\/)?[^/]+/.exec(request ?? '')?.[0];

    if (!packageName || !dependencies.has(packageName)) {
      return callback();
    }

    return callback(null, externalSpecifier(request ?? ''));
  };
}

/**
 * A promise that is resolved when the child exits.
 */
type SpawnResult = Promise<void> & {
  child: childProcess.ChildProcess;
};

let cachedVersion: Promise<string> | undefined;

export default {
  /**
   * Determine if we are building for a development build.
   */
  isDevelopment: true,

  get serial() {
    return process.argv.includes('--serial');
  },

  sleep: util.promisify(setTimeout),

  /**
   * Get the root directory of the repository.
   */
  get rootDir() {
    return path.resolve(import.meta.dirname, '..', '..');
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
    return packageJson;
  },

  /**
   * Packages resolved from node_modules at runtime rather than bundled.
   * electron-builder ships optional dependencies too, and background.ts loads
   * one of them (posix-node) on Linux.
   */
  get runtimeDependencies(): Set<string> {
    return new Set([
      ...Object.keys(this.packageMeta.dependencies),
      ...Object.keys(this.packageMeta.optionalDependencies),
    ]);
  },

  /**
   * Compute the version of the application.
   * @note If the environment variable `RD_MOCK_VERSION` is set, that is used.
   * @param execFile If given, mock `childProcess.execFile` for testing.
   */
  async computeVersion(execFile = util.promisify(childProcess.execFile)): Promise<string> {
    // If we have a mock version (e.g. for screenshots), use that.
    if (process.env.RD_MOCK_VERSION) {
      const validVersion = semver.valid(process.env.RD_MOCK_VERSION);
      if (validVersion) {
        return validVersion;
      }
    }

    // Try to use git to get the version, if available.
    try {
      const { stdout } = await execFile('git', ['describe', '--tags'], { cwd: this.rootDir });
      const trimmedVersion = stdout.trim().replace(/^v/, '');

      if (semver.valid(trimmedVersion)) {
        return trimmedVersion;
      }
    } catch {
      // Ignore the error, use the fallback version.
    }

    const packageVersion = `${ this.packageMeta.version }-fallback`;

    if (semver.valid(packageVersion)) {
      return packageVersion;
    }

    return '0.0.0-fallback';
  },

  /**
   * Get the version of the application.
   */
  get version(): Promise<string> {
    cachedVersion ??= this.computeVersion();
    return cachedVersion;
  },

  get docsUrl(): Promise<string> {
    return (async() => {
      const baseUrl = 'https://docs.rancherdesktop.io';

      // Dev versions have a `git describe`-like version string, e.g.
      // "v1.1.0-1234-g56789abc"; for those, return "next".  This also applies
      // when we failed to get a version, resulting in "v1.2.3-fallback".
      // For anything else, we take the major and minor (but not patch) version,
      // and append anything after dashes; e.g. `v1.9.0-tech-preview` becomes
      // `1.9-tech-preview`.  Note that in practice the version never has a "v"
      // prefix, but we handle it just in case.
      const releasePattern = /^v?(\d+\.\d+)\.\d+(-.*)?$/;
      const developmentPattern = /-(?:\d+-g[0-9a-f]+|fallback)$/;
      const version = await this.version;
      const matches = releasePattern.exec(version);

      if (developmentPattern.test(version)) {
        // Git version; use "next".
        return `${ baseUrl }/next`;
      }
      if (matches) {
        // Release versions, including tech previews.
        return `${ baseUrl }/${ matches[1] }${ matches[2] ?? '' }`;
      }

      // Invalid version string; default to "next".
      return `${ baseUrl }/next`;
    })();
  },

  /**
  * Spawn a new process, returning the child process.
  * @param command The executable to spawn.
  * @param args Arguments to the executable. The last argument may be
  *                        an Object holding options for child_process.spawn().
  */
  spawn(command: string, ...args: (string | childProcess.SpawnOptions)[]): SpawnResult {
    const options: childProcess.SpawnOptions = {
      cwd:   this.rootDir,
      stdio: 'inherit',
    };

    const filteredArgs: string[] = [];
    for (const arg of args) {
      if (arg instanceof Object) {
        _.merge(options, arg);
      } else {
        filteredArgs.push(arg);
      }
    }

    const child = spawn(command, filteredArgs, options);

    const promise = new Promise<void>((resolve, reject) => {
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
  get webpackConfig(): Promise<webpack.Configuration> {
    return (async() => {
      const mode = this.isDevelopment ? 'development' : 'production';

      const config: webpack.Configuration = {
        mode,
        target: 'electron-main',
        node:   {
          __dirname:  false,
          __filename: false,
        },
        entry:         { background: path.resolve(this.rootDir, 'background') },
        experiments:   { outputModule: true },
        // `module-import` leaves a dynamic import dynamic, where plain `module`
        // hoists it to the top of the bundle; @napi-rs/xattr ships no Windows
        // binding, so it must stay behind its `import()`.
        externalsType: 'module-import',
        externals:     [externalsEntry(this.runtimeDependencies)],
        devtool:       this.isDevelopment ? 'source-map' : false,
        resolve:       {
          alias:      { '@pkg': path.resolve(this.rootDir, 'pkg', 'rancher-desktop') },
          extensions: ['.ts', '.js', '.json', '.node'],
          modules:    ['node_modules'],
        },
        output: {
          filename: '[name].js',
          library:  { type: 'modern-module' },
          path:     this.appDir,
        },
        module: {
          rules: [
            {
              test: /\.ts$/,
              use:  {
                loader:  'ts-loader',
                options: { transpileOnly: this.isDevelopment, onlyCompileBundledFiles: true },
              },
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
              test:    /\.ya?ml$/,
              exclude: [/(?:^|[/\\])assets[/\\]scripts[/\\]/, this.distDir],
              use:     { loader: 'js-yaml-loader' },
            },
            {
              test: /\.node$/,
              use:  { loader: 'node-loader' },
            },
            {
              test: /(?:^|[/\\])assets[/\\]scripts[/\\]/,
              type: 'javascript/auto',
              use:  { loader: 'raw-loader' },
            },
          ],
        },
        plugins: [
          new webpack.DefinePlugin({
            'process.env.NODE_ENV':    JSON.stringify(mode),
            'process.env.RD_DOCS_URL': JSON.stringify(await this.docsUrl),
            'process.env.RD_VERSION':  JSON.stringify(await this.version),
          }),
        ],
      };

      return config;
    })();
  },

  /**
   * WebPack configuration for the preload script
   */
  get webpackPreloadConfig(): Promise<webpack.Configuration> {
    return (async() => {
      const overrides: webpack.Configuration = {
        target: 'electron-preload',
        output: {
          filename: '[name].js',
          library:  { type: 'commonjs2' },
          path:     path.join(this.rootDir, 'resources'),
        },
        experiments:   { outputModule: false },
        externalsType: 'commonjs2',
      };

      const result = _.merge({}, await this.webpackConfig, overrides);

      // The preload script is loaded into a sandboxed renderer, from outside the
      // asar, so it can resolve neither npm packages nor the app's node_modules.
      // Bundle everything.  Assigned after the merge because lodash merges
      // arrays element-wise, which would keep the main process's entry.
      result.externals = [];
      const rules = (result.module?.rules ?? []).filter(
        (rule): rule is webpack.RuleSetRule => !!rule && typeof rule === 'object',
      );
      const tsLoader = rules.find((rule) => {
        const { use } = rule;

        if (!use || typeof use !== 'object' || Array.isArray(use)) {
          return false;
        }

        return use.loader === 'ts-loader';
      });

      if (!tsLoader) {
        console.log('rules', util.inspect(rules, false, null, true));
        throw new Error('failed to find TS loader');
      } else if (!tsLoader.use || typeof tsLoader.use !== 'object' || Array.isArray(tsLoader.use)) {
        throw new Error(`Unexpected TS loader config ${ util.inspect(tsLoader, false, null, true) }`);
      }

      tsLoader.use.options = _.merge({}, tsLoader.use.options, { compilerOptions: { noEmit: false } });

      result.entry = { preload: path.resolve(this.rendererSrcDir, 'preload', 'index.ts') };

      return result;
    })();
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
        if (stats?.hasErrors()) {
          return reject(new Error(stats.toString({ colors: true, errorDetails: true })));
        }
        console.log(stats?.toString({ colors: true }));
        resolve();
      });
    });
  },

  get arch(): NodeJS.Architecture {
    return process.env.M1 ? 'arm64' : process.arch;
  },

  /**
   * Build the preload script.
   */
  async buildPreload(): Promise<void> {
    await this.buildJavaScript(await this.webpackPreloadConfig);
  },

  /**
   * Build the main process code.
   */
  buildMain(): Promise<void> {
    return this.wait(async() => this.buildJavaScript(await this.webpackConfig));
  },

};
