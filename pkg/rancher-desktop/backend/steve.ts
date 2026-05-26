import { ChildProcess, spawn } from 'child_process';
import os from 'os';
import path from 'path';

import Electron from 'electron';

import K3sHelper from '@pkg/backend/k3sHelper';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Latch from '@pkg/utils/latch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { send } from '@pkg/window';

const console = Logging.steve;
const ipcMainProxy = getIpcMainProxy(console);

/**
 * @description Singleton that manages the lifecycle of the Steve API.
 */
export class Steve {
  private static instance: Steve;
  private process:         ChildProcess | undefined;

  // Promise to prevent multiple simultaneous calls to start() from causing
  // multiple instances of Steve from being created.
  private pendingStart: Promise<number> | undefined;

  #port = 0;

  private constructor() {
    send('steve-port', 0);
    ipcMainProxy.on('steve-port', () => {
      send('steve-port', this.port);
    });
  }

  /**
   * @description Checks for an existing instance of Steve. If one does not
   * exist, instantiate a new one.
   */
  public static getInstance(): Steve {
    if (!Steve.instance) {
      Steve.instance = new Steve();
    }

    return Steve.instance;
  }

  /**
   * @description Starts the Steve API if one is not already running.
   * Returns only after Steve is ready to accept connections.
   * @returns The port Steve is listening on.
   * @note Concurrent calls are serialized.
   */
  public async start(): Promise<number> {
    // Prevent multiple concurrent calls to start().
    const promise = this.pendingStart || this.startInternal();
    this.pendingStart = promise;
    try {
      return await promise;
    } finally {
      this.pendingStart = undefined;
    }
  }

  /**
   * This is the implementation of `start()`; it should always be called via
   * `start()`, as it does not guard against concurrent calls.
   */
  private async startInternal(): Promise<number> {
    if (this.isRunning) {
      if (this.port) {
        console.debug(`Steve is already running with port: ${ this.port }`);

        return this.port;
      }
      // If the process is running, but we don't have a port, suspect that Steve
      // is in a bad state and restart it.
      console.warn(`Steve process is running without a port. Restarting...`);
      this.stop();
    }

    const osSpecificName = /^win/i.test(os.platform()) ? 'steve.exe' : 'steve';
    const stevePath = path.join(paths.resources, os.platform(), 'internal', osSpecificName);
    const env = Object.assign({}, process.env);

    try {
      env.KUBECONFIG = await K3sHelper.findKubeConfigToUpdate('rancher-desktop');
    } catch {
      // do nothing
    }
    console.debug(`Starting Steve with KUBECONFIG=${ env.KUBECONFIG }`);
    const childProcess = spawn(stevePath, ['--context', 'rancher-desktop'],
      { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.process = childProcess;

    const { stdout, stderr } = childProcess;
    let portBuffer = '';
    const portLatch = Latch<number>();

    if (!stdout || !stderr) {
      console.error('Unable to get child process...');

      throw new Error(`Failed to start Steve: could not get output`);
    }

    // Steve has been modified to output the port to stdout and then immediately
    // close it, leaving stderr open for logs.
    console.debug('Waiting for Steve to output port...');
    stdout.on('data', (data) => {
      portBuffer += data.toString();
    });
    stdout.on('end', () => {
      const port = parseInt(portBuffer, 10);
      if (port) {
        portLatch.resolve(port);
      } else {
        portLatch.reject(new Error(`Failed to parse Steve port from output: ${ portBuffer }`));
      }
    });

    // Set up a handler for the port latch erroring in case we never get to the
    // point of waiting for it.
    portLatch.catch((err) => {
      console.error(err);
      try {
        // Kill the child process if it's still alive.
        childProcess.kill();
      } catch { /* ignore */ }
    });

    stderr.on('data', (data) => {
      console.error(`stderr: ${ data }`);
    });

    childProcess.on('exit', (code, signal) => {
      if (childProcess !== this.process) {
        // A stale process has exited; ignore.
        console.debug(`Stale steve process exited with code ${ code } and signal ${ signal }`);
        return;
      }
      console.log(`Steve process exited with code ${ code } and signal ${ signal }`);
      this.#port = 0;
      send('steve-port', 0);
      portLatch.reject(new Error(`Steve process exited unexpectedly with code ${ code } and signal ${ signal }`));
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('Timed out waiting for Steve to start');
        portLatch.reject(error); // Kills the child process.
        reject(error);
      }, 10_000);
      childProcess.once('spawn', () => {
        clearTimeout(timeout);
        console.debug(`Spawned child pid: ${ childProcess.pid }`);
        resolve();
      });
      childProcess.once('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Steve: ${ err.message }`, { cause: err }));
      });
    });
    // Set a timeout in case Steve fails to listen to a port.
    const portTimeout = setTimeout(() => {
      portLatch.reject(new Error('Timed out waiting for Steve port'));
    }, 30_000);
    try {
      const port = await portLatch;
      console.debug(`Steve is listening on port: ${ port }`);

      await this.waitForReady(port);
      this.#port = port;
      send('steve-port', port);

      return port;
    } finally {
      clearTimeout(portTimeout);
    }
  }

  private get isRunning() {
    const { pid, exitCode, signalCode } = this.process || { };

    return !!pid && exitCode === null && signalCode === null;
  }

  public get port() {
    return this.#port;
  }

  /**
   * Wait for Steve to be ready to serve API requests.
   */
  private async waitForReady(port: number): Promise<void> {
    const maxAttempts = 60;
    const delayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!this.isRunning) {
        throw new Error('Steve process exited before becoming ready');
      }

      if (await this.isPortReady(port)) {
        console.debug(`Steve is ready after ${ attempt } / ${ maxAttempts } attempt(s)`);

        return;
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error(`Steve did not become ready after ${ maxAttempts * delayMs / 1000 } seconds`);
  }

  /**
   * Check if Steve has finished initializing its API controllers.
   * Steve accepts HTTP connections and responds to /v1 before its
   * controllers have discovered all resource schemas from the K8s
   * API server. The dashboard fails if schemas are incomplete, so
   * we probe a core resource endpoint that returns 404 until the
   * schema controller has registered it.
   */
  private async isPortReady(port: number): Promise<boolean> {
    try {
      // Set up a short time out, so we don't wait too long.
      const signal = AbortSignal.timeout(1_000);
      const resp = await Electron.net.fetch(
        `http://127.0.0.1:${ port }/v1/namespaces`,
        { redirect: 'error', signal });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Stops the Steve API.
   */
  public stop() {
    this.#port = 0;
    send('steve-port', 0);
    if (this.isRunning) {
      this.process?.kill('SIGINT');
    }
  }
}
