import timers from 'timers';

import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';

const console = Logging.background;

/**
 * This manages a given persistent background process that must be kept running
 * indefinitely (until stop is called).
 */
export default class BackgroundProcess {
  /**
   * The process being managed.
   */
  protected process: childProcess.ChildProcess | null = null;

  /**
   * A descriptive name of this process, for logging.
   */
  protected name: string;

  /**
   * A function which will spawn the process to be monitored.
   */
  protected spawn: () => Promise<childProcess.ChildProcess>;

  /** A function which will terminate the process. */
  protected destroy: (child: childProcess.ChildProcess) => Promise<void>;

  /**
   * Whether the process should be running.
   */
  protected shouldRun = false;

  /**
   * Timer used to restart the process;
   */
  protected timer: NodeJS.Timeout | null = null;

  /**
   *
   * @param backend The owning Kubernetes backend; this is used to avoid running in an invalid state.
   * @param name A descriptive name of the process for logging.
   * @param spawn A function to create the underlying child process.
   * @param destroy Optional function to stop the underlying child process.
   */
  constructor(name: string, spawn: typeof BackgroundProcess.prototype.spawn, destroy?: typeof BackgroundProcess.prototype.destroy) {
    this.name = name;
    this.spawn = spawn;
    this.destroy = destroy ?? ((process) => {
      process?.kill('SIGTERM');

      return Promise.resolve();
    });
  }

  /**
   * Start the process asynchronously if it does not already exist, and attempt
   * to keep it running indefinitely.
   */
  start() {
    this.shouldRun = true;
    this.restart();
  }

  /**
   * Attempt to start the process once.
   */
  protected async restart() {
    if (!this.shouldRun) {
      console.debug(`Not restarting ${ this.name } because shouldRun is ${ this.shouldRun }`);
      await this.stop();

      return;
    }
    if (this.process) {
      await this.destroy(this.process);
    }
    if (this.timer) {
      // Ideally, we should use this.timer.refresh(); however, it does not
      // appear to actually trigger.
      timers.clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`Launching background process ${ this.name }.`);
    const process = await this.spawn();

    this.process = process;
    process.on('exit', (status, signal) => {
      if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
        console.log(`Background process ${ this.name } exited gracefully.`);
      } else {
        console.log(`Background process ${ this.name } exited with status ${ status } signal ${ signal }`);
      }
      if (!Object.is(process, this.process)) {
        console.log(`Not current ${ this.name } process; nothing to be done.`);

        return;
      }
      if (this.shouldRun) {
        this.timer = timers.setTimeout(this.restart.bind(this), 1_000);
        console.debug(`Background process ${ this.name } will restart.`);
      }
    });
  }

  /**
   * Stop the process and do not restart it.
   */
  async stop() {
    console.log(`Stopping background process ${ this.name }.`);
    this.shouldRun = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.process) {
      await this.destroy(this.process);
    }
  }
}
