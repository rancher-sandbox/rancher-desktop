import { ChildProcess, spawn } from 'child_process';
import process from 'process';
import path from 'path';
import { executable } from '@/resources';
import Logging from '@/utils/logging';

const console = Logging.steve;

/**
 * @description Singleton that manages the lifecycle of the Steve API
 */
export class Steve {
  private static instance: Steve;
  private process!: ChildProcess;
  private uiPath() {
    return path.join(process.cwd(), 'resources', 'rancher-dashboard');
  }

  private isRunning: boolean;

  // eslint-disable-next-line no-useless-constructor
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
  public start() {
    const { pid } = this.process || { };

    if (this.isRunning && pid) {
      console.debug(`Steve is already running with pid: ${ pid }`);

      return;
    }

    this.process = spawn(
      executable('steve'),
      [
        '--context',
        'rancher-desktop',
        '--ui-path',
        this.uiPath(),
        '--offline',
        'true'
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
