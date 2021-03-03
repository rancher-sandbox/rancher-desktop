/**
 * This module is a helper for the build & dev scripts.
 */

import childProcess from 'child_process';
import fs from 'fs/promises';
import { createRequire } from 'module';
import os from 'os';
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
   * Recursively copy the contents of srcDir to destDir.  This only supports
   * directories and plain files.  The destination directory does not have to
   * exist before copying.
   * @param srcDir {string} Path to the source directory.
   * @param destDir {string} Path to the destination directory.
   * @param filter {(string) => boolean} Filtering function; given relative path
   *               of a file, return false if it should not be copied.  This is
   *               not used for the directories.
   */
  async copy(srcDir, destDir, filter = () => true) {
    // nodejs stdlib can't copy files recursively, or even walk directories.
    // Do everything manually...
    /**
     * Promises about pending directory creations.
     * @type {Promise<void>[]}
     */
    const dirPromises = [];
    /**
     * The set of files to copy; this excludes directories.
     * @type {Set<string>}
     */
    const files = new Set();

    async function findThingsToCopy(root, child = '') {
      for await (const entry of await fs.opendir(path.join(root, child) )) {
        const relPath = path.join(child, entry.name);

        if (entry.isDirectory()) {
          dirPromises.push(fs.mkdir(
            path.join(destDir, relPath),
            { recursive: true },
          ));
          await findThingsToCopy(root, relPath);
        } else {
          files.add(relPath);
        }
      }
    }
    await findThingsToCopy(srcDir);
    await Promise.all(dirPromises);
    await Promise.all([...files].filter(filter).map(relPath => fs.copyFile(
      path.join(srcDir, relPath),
      path.join(destDir, relPath),
    )));
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

  async buildStratos() {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stratos-'));

    try {
      const stratosBinDir = path.resolve(this.stratosSrcDir, 'node_modules', '.bin');
      const executablePath = path.resolve(this.srcDir, 'resources', 'darwin', 'jetstream');
      const configFile = path.resolve(tempDir, 'stratos.yaml');
      const env = {
        ...process.env,
        PATH:         stratosBinDir + path.delimiter + process.env.PATH,
        STRATOS_YAML: configFile,
      };

      await fs.writeFile(configFile, JSON.stringify({
        packages: {
          desktop: true,
          include: [
            '@stratosui/core',
            '@stratosui/shared',
            '@stratosui/kubernetes',
            '@stratosui/desktop-extensions',
            '@stratosui/theme',
          ],
        }
      }));
      // Check out the source code
      await runIfMissing(path.resolve(this.stratosSrcDir, 'package.json'), async() => {
        await this.spawn('git', 'submodule', 'update', '--init', 'src/stratos');
      });
      await runIfMissing(stratosBinDir, async() => {
        await this.spawn('npm', 'install', { cwd: this.stratosSrcDir });
      });

      const buildFrontEnd = async() => {
        await runIfMissing(path.resolve(this.stratosSrcDir, 'dist', 'index.html'), async() => {
          await this.spawn('ng', 'build', '--configuration=desktop', {
            cwd: this.stratosSrcDir,
            env,
          });
        });
        await runIfMissing(path.resolve(this.stratosConfigDir, 'index.html'), async() => {
          await this.copy(
            path.resolve(this.stratosSrcDir, 'dist'),
            this.stratosConfigDir,
            f => f !== 'index.html',
          );

          // Copy index.html manually at the end, as a marker.
          await fs.copyFile(
            path.join(this.stratosSrcDir, 'dist', 'index.html'),
            path.join(this.stratosConfigDir, 'index.html'),
          );
        });
      };

      const buildBackEnd = async() => {
        await runIfMissing(path.resolve(this.stratosJetstreamDir, 'jetstream'), async() => {
          await this.spawn('npm', 'run', 'build-backend', { cwd: this.stratosJetstreamDir, env });
        });
        await runIfMissing(executablePath, async() => {
          await fs.copyFile(
            path.resolve(this.stratosJetstreamDir, 'jetstream'),
            executablePath,
          );
        });
      };

      await this.wait(buildFrontEnd, buildBackEnd);
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  },
};

/**
 * Run the provided callback function if the path given does not exist.
 * @param path {string} File/directory to check existance of.
 * @param fn {() => Promise<void>} Task to run if the file is missing.
 */
async function runIfMissing(path, fn) {
  try {
    await fs.stat(path);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }

    return await fn();
  }
}
