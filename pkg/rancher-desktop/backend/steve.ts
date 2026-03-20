import { ChildProcess, spawn } from 'child_process';
import http from 'http';
import os from 'os';
import path from 'path';
import { setTimeout } from 'timers/promises';

import K3sHelper from '@pkg/backend/k3sHelper';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.steve;

/**
 * @description Singleton that manages the lifecycle of the Steve API.
 */
export class Steve {
  private static instance: Steve;
  private process!:        ChildProcess;

  private isRunning: boolean;
  private httpsPort = 0;
  private httpPort = 0;

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
   * @param httpsPort The HTTPS port for Steve to listen on.
   * @param httpPort The HTTP port for Steve to listen on.
   */
  public async start(httpsPort: number, httpPort: number) {
    const { pid } = this.process || { };

    if (this.isRunning && pid) {
      console.debug(`Steve is already running with pid: ${ pid }`);

      return;
    }

    this.httpsPort = httpsPort;
    this.httpPort = httpPort;

    const osSpecificName = /^win/i.test(os.platform()) ? 'steve.exe' : 'steve';
    const stevePath = path.join(paths.resources, os.platform(), 'internal', osSpecificName);
    const env = Object.assign({}, process.env);

    try {
      env.KUBECONFIG = await K3sHelper.findKubeConfigToUpdate('rancher-desktop');
    } catch {
      // do nothing
    }
    this.process = spawn(
      stevePath,
      [
        '--context',
        'rancher-desktop',
        '--ui-path',
        path.join(paths.resources, 'rancher-dashboard'),
        '--offline',
        'true',
        '--https-listen-port',
        String(httpsPort),
        '--http-listen-port',
        String(httpPort),
      ],
      { env },
    );

    const { stdout, stderr } = this.process;

    if (!stdout || !stderr) {
      console.error('Unable to get child process...');

      return;
    }

    stdout.on('data', (data: any) => {
      console.log(`stdout: ${ data }`);
    });

    stderr.on('data', (data: any) => {
      console.error(`stderr: ${ data }`);
    });

    this.process.on('close', (code: any) => {
      console.log(`child process exited with code ${ code }`);
      this.isRunning = false;
    });

    await new Promise<void>((resolve, reject) => {
      this.process.once('spawn', () => {
        this.isRunning = true;
        console.debug(`Spawned child pid: ${ this.process.pid }`);
        resolve();
      });
      this.process.once('error', (err) => {
        reject(new Error(`Failed to spawn Steve: ${ err.message }`, { cause: err }));
      });
    });

    await this.waitForReady();
  }

  /**
   * Wait for Steve to be ready to serve API requests.
   */
  private async waitForReady(): Promise<void> {
    const maxAttempts = 60;
    const delayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!this.isRunning) {
        throw new Error('Steve process exited before becoming ready');
      }

      if (await this.isPortReady()) {
        console.debug(`Steve is ready after ${ attempt } attempt(s)`);

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
  private isPortReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port:     this.httpPort,
        path:     '/v1/namespaces',
        method:   'GET',
        timeout:  1000,
        agent:    false,
      }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  /**
   * Stops the Steve API.
   */
  public stop() {
    if (!this.isRunning) {
      return;
    }

    this.process.kill('SIGINT');
  }
}
