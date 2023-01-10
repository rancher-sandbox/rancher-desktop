/**
 * This script runs the end-to-end tests.
 */

'use strict';

import childProcess from 'child_process';
import events from 'events';
import util from 'util';

import buildUtils from './lib/build-utils';

const sleep = util.promisify(setTimeout);

class E2ETestRunner extends events.EventEmitter {
  emitError(message: string, error: any) {
    let combinedMessage = message;

    if (error?.message) {
      combinedMessage += `: ${ error.message }`;
    }
    const newError: Error & { code?: number } = new Error(combinedMessage);

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
   * @param title The title of the process to show in messages.
   * @param command The executable to run.
   * @param  args Any arguments to the executable.
   * @returns The new child process.
   */
  spawn(title: string, command: string, ...args: string[]): childProcess.ChildProcess {
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

  #testProcess: null | childProcess.ChildProcess = null;
  startTestProcess(): Promise<void> {
    const args = process.argv.slice(2).filter(x => x !== '--serial');
    const spawnArgs = ['node_modules/@playwright/test/cli.js', 'test', '--config=e2e/config/playwright-config.ts'];

    if (process.env.CIRRUS_CI) {
      spawnArgs.push('--retries=2');
    }
    this.#testProcess = this.spawn('Test process', 'node', ...spawnArgs, ...args);

    return new Promise((resolve, reject) => {
      this.#testProcess?.on('exit', (code: number, signal: string) => {
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

  #rendererProcess: null | childProcess.ChildProcess = null;
  /**
   * Start the renderer process.
   */
  startRendererProcess(): Promise<void> {
    this.#rendererProcess = this.spawn('Renderer process',
      'node', 'node_modules/nuxt/bin/nuxt.js',
      '--hostname', 'localhost',
      '--port', this.rendererPort.toString(), buildUtils.rendererSrcDir);

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
    console.log(`ENV Detected CI:${ process.env.CI } - Setting up Loading timeout: ${ ciTimeout }ms`);

    return sleep(ciTimeout);
  } else {
    console.log(`ENV Detected non-CI:${ process.env.NODE_ENV } - Setting up Loading timeout: ${ devTimeout }ms`);

    return sleep(devTimeout);
  }
}
