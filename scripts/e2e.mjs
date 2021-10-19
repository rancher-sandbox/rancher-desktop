/**
 * This script runs the end-to-end tests.
 */

'use strict';

import events from 'events';
import buildUtils from './lib/build-utils.mjs';

class E2ETestRunner extends events.EventEmitter {
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

  exit() {
    this.#rendererProcess?.kill();
    this.#testProcess?.kill();
  }

  #testProcess = null
  startTestProcess() {
    const args = process.argv.slice(2).filter(x => x !== '--serial');

    this.#testProcess = this.spawn('Test process',
      'node', 'node_modules/jest/bin/jest.js',
      '--config', './e2e/jest.e2e.config.json',
      '--detectOpenHandles', '--forceExit', ...args);

    return new Promise((resolve, reject) => {
      this.#testProcess.on('exit', (code, signal) => {
        if (code === 201) {
          console.log('Another instance of Rancher Desktop is already running');
          resolve();
        } else if (code > 0) {
          console.log(`Rancher Desktop: main process exited with status ${ code }`);
          reject(code);
        } else if (signal) {
          console.log(`Rancher Desktop: main process exited with signal ${ signal }`);
          reject(signal);
        } else {
          resolve(process.exit());
        }
      });
    });
  }

  #rendererProcess = null
  /**
   * Start the renderer process.
   * @returns {Promise<void>}
   */
  startRendererProcess() {
    this.#rendererProcess = this.spawn('Renderer process',
      'node', 'node_modules/nuxt/bin/nuxt.js',
      '--port', this.rendererPort, buildUtils.rendererSrcDir);

    return Promise.resolve();
  }

  async run() {
    try {
      process.env.NODE_ENV = 'test';
      await buildUtils.wait(
        () => this.startRendererProcess(),
        () => buildUtils.buildMain(),
      );
      await isCiOrDevelopmentTimeout();
      await this.startTestProcess();
    } finally {
      this.exit();
    }
  }
}

(new E2ETestRunner()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});

function isCiOrDevelopmentTimeout() {
  const ciTimeout = 40000;
  const devTimeout = 20000;

  if (process.env.CI) {
    console.log(`ENV Detected:${ process.env.CI } - Setting up Loading timeout: ${ ciTimeout }ms`);

    return sleep(ciTimeout);
  } else {
    console.log(`ENV Detected:${ process.env.NODE_ENV } - Setting up Loading timeout: ${ devTimeout }ms`);

    return sleep(devTimeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
