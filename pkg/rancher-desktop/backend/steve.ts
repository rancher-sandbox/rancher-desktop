import { ChildProcess, spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { setTimeout } from 'timers/promises';

import Electron from 'electron';

import K3sHelper from '@pkg/backend/k3sHelper';
import Latch from '@pkg/utils/latch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.steve;

/**
 * @description Singleton that manages the lifecycle of the Steve API.
 */
export class Steve {
  private static instance: Steve;
  private process:         ChildProcess | undefined;

  private isRunning: boolean;
  #port = 0;

  private constructor() {
    this.isRunning = false;
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
   */
  public async start(): Promise<number> {
    const { pid } = this.process || { };

    if (this.isRunning && pid) {
      console.debug(`Steve is already running with pid: ${ pid }`);

      return this.#port;
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
    this.process = spawn(stevePath, ['--context', 'rancher-desktop'],
      { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    const { stdout, stderr } = this.process;
    let portBuffer = '';
    const portLatch = Latch<number>();

    if (!stdout || !stderr) {
      console.error('Unable to get child process...');

      throw new Error(`Failed to start Steve: could not get output`);
    }

    // Steve has been modified to output the port to stdout and then immediate
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

    stderr.on('data', (data) => {
      console.error(`stderr: ${ data }`);
    });

    this.process.on('exit', (code, signal) => {
      console.log(`child process exited with code ${ code } and signal ${ signal }`);
      this.isRunning = false;
      portLatch.reject(new Error(`Steve process exited unexpectedly with code ${ code } and signal ${ signal }`));
    });

    await new Promise<void>((resolve, reject) => {
      this.process?.once('spawn', () => {
        this.isRunning = true;
        console.debug(`Spawned child pid: ${ this.process?.pid }`);
        resolve();
      });
      this.process?.once('error', (err) => {
        reject(new Error(`Failed to spawn Steve: ${ err.message }`, { cause: err }));
      });
      setTimeout(10_000).then(() => reject(new Error('Timed out waiting for Steve to start')));
    });
    this.#port = await portLatch;
    console.debug(`Steve is listening on port: ${ this.#port }`);

    await this.waitForReady(this.#port);

    return this.#port;
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

      await setTimeout(delayMs);
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
    if (!this.isRunning) {
      return;
    }

    this.process?.kill('SIGINT');
    this.#port = 0;
  }
}
