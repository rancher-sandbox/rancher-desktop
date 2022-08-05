/**
 * This script runs the application for development.
 */

'use strict';

import events from 'events';
import util from 'util';

import Electron from 'electron';
import fetch from 'node-fetch';

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

  #mainProcess = null;
  async startMainProcess() {
    try {
      await buildUtils.buildMain();
      // Wait for the renderer to finish, so that the output from nuxt doesn't
      // clobber debugging output.
      while (true) {
        if ((await fetch('http://localhost:8888/pages/General')).ok) {
          break;
        }
        await util.promisify(setTimeout)(1000);
      }
      this.#mainProcess = this.spawn(
        'Main process',
        'node',
        'node_modules/electron/cli.js',
        buildUtils.srcDir,
        this.rendererPort,
        ...process.argv
      );
      this.#mainProcess.on('exit', (code, signal) => {
        if (code === 201) {
          console.log('Another instance of Rancher Desktop is already running');
        } else if (code > 0) {
          console.log(`Rancher Desktop: main process exited with status ${ code }`);
        } else if (signal) {
          console.log(`Rancher Desktop: main process exited with signal ${ signal }`);
        }
      });
    } catch (err) {
      console.log(`Failure in startMainProcess: ${ err }`);
    }
  }

  #rendererProcess = null;
  /**
   * Start the renderer process.
   * @returns {Promise<void>}
   */
  startRendererProcess() {
    this.#rendererProcess = this.spawn('Renderer process',
      'node', 'node_modules/nuxt/bin/nuxt.js',
      '--hostname', 'localhost',
      '--port', this.rendererPort, buildUtils.rendererSrcDir);

    return Promise.resolve();
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
    } catch (err) {
      if (/Main process error: Process exited with code 201/.test(err)) {
        // do nothing
      } else {
        console.error(err);
      }
    } finally {
      this.exit();
    }
  }
}

(new DevRunner()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});
