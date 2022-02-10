import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { executable } from '@/resources';

/**
 * @description Singleton that manages the lifecycle of the Steve API
 */
export class Steve {
  private static instance: Steve;
  private process!: ChildProcess;
  private uiPath = path.join(process.cwd(), 'resources', os.platform(), 'index.html');

  // eslint-disable-next-line no-useless-constructor
  private constructor() { }

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
  public start() {
    const { pid } = this.process || { };

    if (pid) {
      console.debug(`Steve has pid: ${ pid }`);

      return;
    }

    this.process = spawn(
      executable('steve'),
      [
        '--context',
        'rancher-desktop',
        '--ui-path',
        this.uiPath
      ]
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
    });

    console.debug(`Spawned child pid: ${ this.process.pid }`);
  }

  /**
   * Stops the Steve API.
   */
  public stop() {
    const { pid } = this.process || { };

    if (!pid) {
      return;
    }

    this.process.kill();
  }
}
