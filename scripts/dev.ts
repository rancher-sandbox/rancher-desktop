/**
 * This script runs the application for development.
 */

'use strict';

import childProcess from 'child_process';
import events from 'events';
import https from 'https';

import fetch from 'node-fetch';

import buildUtils from './lib/build-utils';

interface RendererEnv {
  home: string;
  agent?: https.Agent | undefined;
}

class DevRunner extends events.EventEmitter {
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
   * @param args Any arguments to the executable.
   * @returns The new child process.
   */
  spawn(title: string, command: string, ...args: string[]): childProcess.ChildProcess {
    const promise = buildUtils.spawn(command, ...args);

    promise
      .then(() => this.exit())
      .catch(error => this.emitError(`${ title } error`, error));

    return promise.child;
  }

  /**
   * Gets information about the renderer based on the environment variable
   * RD_ENV_PLUGINS_DEV. For plugins development.
   */
  rendererEnv(): RendererEnv {
    if (process.env.RD_ENV_PLUGINS_DEV) {
      return {
        home:  'https://localhost:8888/home',
        agent: new https.Agent({ rejectUnauthorized: false }),
      };
    }

    return { home: 'http://localhost:8888' };
  }

  #mainProcess: childProcess.ChildProcess | null = null;
  async startMainProcess() {
    console.info('Main process: starting...');
    try {
      await buildUtils.buildMain();

      this.#mainProcess = this.spawn(
        'Main process',
        'node',
        'node_modules/electron/cli.js',
        buildUtils.rootDir,
        this.rendererPort.toString(),
        ...process.argv,
      );
      this.#mainProcess.on('exit', (code: number, signal: string) => {
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

  #rendererProcess: null | childProcess.ChildProcess = null;
  /**
   * Start the renderer process.
   */
  async startRendererProcess(): Promise<void> {
    await buildUtils.buildPreload();

    return new Promise((resolve, reject) => {
      console.info('Renderer process: starting...');
      this.#rendererProcess = this.spawn(
        'Renderer process',
        'yarn',
        'run',
        'dev:ui',
        '--hostname',
        'localhost',
        '--port',
        this.rendererPort.toString(),
      );

      // Listen for the 'exit' event of the child process and resolve or reject the Promise accordingly.
      this.#rendererProcess.on('exit', (code, _signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Renderer build failed with code ${ code }`));
        }
      });

      // Wait for the renderer to finish, so that vue-cli output doesn't
      // clobber debugging output.
      const rendererEnv = this.rendererEnv();
      const maxRetries = 10;
      let retryCount = 0;
      let devServerStarted = false;

      const serverCheckInterval = setInterval(async() => {
        if (devServerStarted) {
          return;
        }

        try {
          const response = await fetch(rendererEnv.home, { agent: rendererEnv.agent });

          if (response.ok) {
            clearInterval(serverCheckInterval);
            if (!devServerStarted) {
              console.info('Renderer process: dev server started');
              devServerStarted = true;
            }
            resolve();
          }
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            clearInterval(serverCheckInterval);
            reject(new Error(`Renderer build failed to connect after ${ maxRetries } attempts`));
          }
        }
      }, 1000);
    });
  }

  exit() {
    this.#rendererProcess?.kill();
    this.#mainProcess?.kill();
  }

  async run() {
    process.env.NODE_ENV = 'development';
    try {
      await this.startRendererProcess();

      await buildUtils.wait(
        () => this.startMainProcess(),
      );

      await new Promise((resolve, reject) => {
        this.on('error', reject);
      });
    } catch (err: any) {
      if (typeof err === 'string' && /Main process error: Process exited with code 201/.test(err)) {
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
