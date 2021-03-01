/**
 * This script runs the application for development.
 */

'use strict';

import events from 'events';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import util from 'util';
import buildUtils from './lib/build-utils.mjs';

class DevRunner extends events.EventEmitter {
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
    const promise = buildUtils.spawn(command, ...args);

    promise
      .then(() => this.exit())
      .catch(error => this.emitError(`${ title } error`, error));

    return promise.child;
  }

  #mainProcess = null
  async startMainProcess() {
    await buildUtils.wait(
      () => buildUtils.buildMain(),
      () => this.generateStratosCerts(),
      () => this.buildStratos(),
    );
    this.#mainProcess = this.spawn('Main process',
      'electron', buildUtils.srcDir, this.rendererPort);
  }

  #rendererProcess = null
  /**
   * Start the renderer process.
   * @returns {Promise<void>}
   */
  async startRendererProcess() {
    this.#rendererProcess = this.spawn('Renderer process',
      'nuxt', '--port', this.rendererPort, buildUtils.rendererSrcDir);

    if (buildUtils.serial) {
      // Wait for the renderer to be ready, so that nuxt doesn't clobber other
      // output.
      for (;;) {
        try {
          await new Promise((resolve, reject) => {
            const request = http.get({
              port: this.rendererPort,
              path: '/_nuxt/pages/Welcome.js',
            });

            request.on('error', reject);
            request.on('response', (message) => {
              if (message.statusCode >= 200 && message.statusCode < 400) {
                return resolve();
              }
              reject(new Error(`Unexpected status code ${ message.statusCode }`));
            });
            setTimeout(reject, 5000);
          });
          break;
        } catch (err) {
          await util.promisify(setTimeout)(100);
        }
      }
    }
  }

  /**
   * Generate TLS certificates for Stratos.
   * @returns {Promise<void>}
   */
  async generateStratosCerts() {
    await fs.mkdir(buildUtils.stratosConfigDir, { recursive: true });
    await runIfMissing(path.resolve(buildUtils.stratosConfigDir, 'pproxy.key'), async() => {
      const script = path.resolve(buildUtils.stratosSrcDir, 'deploy', 'tools', 'generate_cert.sh');

      await buildUtils.spawn(script, { env: { CERTS_PATH: buildUtils.stratosConfigDir } });
    });
  }

  async buildStratos() {
    const stratosBinDir = path.resolve(buildUtils.stratosSrcDir, 'node_modules', '.bin');
    const executablePath = path.resolve(buildUtils.srcDir, 'resources', 'darwin', 'jetstream');
    const env = {
      ...process.env,
      PATH:         stratosBinDir + path.delimiter + process.env.PATH,
      STRATOS_YAML: path.resolve(buildUtils.stratosSrcDir, 'electron', 'stratos.yaml'),
    };

    await runIfMissing(path.resolve(buildUtils.stratosSrcDir, 'package.json'), async() => {
      await buildUtils.spawn('git', 'submodule', 'update', '--init', 'src/stratos');
    });
    await runIfMissing(stratosBinDir, async() => {
      await buildUtils.spawn('npm', 'install', { cwd: buildUtils.stratosSrcDir });
    });
    await runIfMissing(path.resolve(buildUtils.stratosSrcDir, 'dist'), async() => {
      await buildUtils.spawn('ng', 'build', '--configuration=desktop', {
        cwd: buildUtils.stratosSrcDir,
        env,
      });
    });
    await runIfMissing(path.resolve(buildUtils.stratosJetstreamDir, 'jetstream'), async() => {
      await buildUtils.spawn('npm', 'run', 'build-backend', { cwd: buildUtils.stratosJetstreamDir, env });
    });
    await runIfMissing(executablePath, async() => {
      await fs.copyFile(
        path.resolve(buildUtils.stratosJetstreamDir, 'jetstream'),
        executablePath,
      );
    });
  }

  exit() {
    this.#rendererProcess?.kill();
    this.#mainProcess?.kill();
  }

  async run() {
    process.env.NODE_ENV = 'development';
    try {
      await buildUtils.wait(
        () => this.startRendererProcess(),
        () => this.startMainProcess(),
      );
      await new Promise((resolve, reject) => {
        this.on('error', reject);
      });
    } finally {
      this.exit();
    }
  }
}

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

(new DevRunner()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});
