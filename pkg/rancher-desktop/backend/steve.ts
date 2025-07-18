import { ChildProcess, spawn } from 'child_process';
import os from 'os';
import path from 'path';

import K3sHelper from '@pkg/backend/k3sHelper';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.steve;

/**
 * @description Singleton that manages the lifecycle of the Steve API
 */
export class Steve {
  private static instance: Steve;
  private process!:        ChildProcess;

  private isRunning: boolean;

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
   */
  public async start() {
    const { pid } = this.process || { };

    if (this.isRunning && pid) {
      console.debug(`Steve is already running with pid: ${ pid }`);

      return;
    }

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

    this.process.on('spawn', () => {
      this.isRunning = true;
    });

    this.process.on('close', (code: any) => {
      console.log(`child process exited with code ${ code }`);
      this.isRunning = false;
    });

    console.debug(`Spawned child pid: ${ this.process.pid }`);
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
