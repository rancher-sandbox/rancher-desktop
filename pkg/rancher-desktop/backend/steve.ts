import { ChildProcess, spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { setTimeout } from 'timers/promises';

import Electron from 'electron';

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
   */
  public async start(httpsPort: number) {
    const { pid } = this.process || { };

    if (this.isRunning && pid) {
      console.debug(`Steve is already running with pid: ${ pid }`);

      return;
    }

    this.httpsPort = httpsPort;

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
        '0', // Disable HTTP support; it does not work correctly anyway.
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
  private isPortReady(): Promise<boolean> {
    // Steve's HTTP port just redirects to HTTPS, so we might as well go to the
    // HTTPS port directly.  We will need to ignore certificate errors; however,
    // neither the NodeJS stack nor Electron.net.request() would pass through
    // the `Electron.app.on('certificate-error', ...)` handler, so we cannot use
    // the normal certificate handling for this health check.  Instead, we
    // create a temporary session with a certificate verify proc that ignores
    // errors, and use that session for the health check request.
    return new Promise((resolve) => {
      const session = Electron.session.fromPartition('steve-healthcheck', { cache: false });

      session.setCertificateVerifyProc((request, callback) => {
        if (request.hostname === '127.0.0.1') {
          // We do not have any more information to narrow down the certificate;
          // given that we're doing this in a private partition, it should be
          // safe to allow all localhost certificates.  In particular, we do not
          // get access to the port number, and all the Steve certificates have
          // generic fields (e.g. subject).
          callback(0);
        } else {
          // Unexpected request; not sure how this could happen in a new session,
          // but we can at least pretend to do the right thing.
          callback(-3); // Use Chromium's default verification.
        }
      });

      const req = Electron.net.request({
        protocol: 'https:',
        hostname: '127.0.0.1',
        port:     this.httpsPort,
        path:     '/v1/namespaces',
        method:   'GET',
        redirect: 'error',
        session,
      });

      req.on('response', (res) => resolve(res.statusCode === 200));
      req.on('error', () => resolve(false));
      // Timeout if we don't get a response in a reasonable time.
      setTimeout(1_000).then(() => {
        try {
          req.abort();
        } catch {
          // ignore
        }
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
