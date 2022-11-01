import timers from 'timers';

import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';

const console = Logging.background;

type BackgroundProcessConstructorOptions = {
  /** A function to create the underlying child process. */
  spawn: () => Promise<childProcess.ChildProcess>;
  /** Optional function to stop the underlying child process. */
  destroy?: (child: childProcess.ChildProcess) => Promise<void>;
  /** Additional checks to see if the process should be strarted. */
  shouldRun?: () => Promise<boolean>;
};

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
  protected spawn: BackgroundProcessConstructorOptions['spawn'];

  /** A function which will terminate the process. */
  protected destroy: Required<BackgroundProcessConstructorOptions>['destroy'];

  /** A function that provides an additional check if this process should run. */
  protected shouldRunCallback: Required<BackgroundProcessConstructorOptions>['shouldRun'];

  /**
   * Whether the process should be running.
   */
  protected started = false;

  /**
   * Timer used to restart the process;
   */
  protected timer: NodeJS.Timeout | null = null;

  /**
   * @param name A descriptive name of the process for logging.
   */
  constructor(name: string, options: BackgroundProcessConstructorOptions) {
    this.name = name;
    this.spawn = options.spawn;
    this.destroy = options.destroy ?? ((process) => {
      process?.kill('SIGTERM');

      return Promise.resolve();
    });
    this.shouldRunCallback = options.shouldRun ?? function() {
      return Promise.resolve(true);
    };
  }

  /**
   * Start the process asynchronously if it does not already exist, and attempt
   * to keep it running indefinitely.
   */
  start() {
    this.started = true;
    this.restart();
  }

  /**
   * Check if the process should be running at this point in time.
   */
  protected async shouldRun() {
    return this.started && await this.shouldRunCallback();
  }

  /**
   * Attempt to start the process once.
   */
  protected async restart() {
    if (!await this.shouldRun()) {
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
      this.shouldRun().then((result) => {
        if (result) {
          this.timer = timers.setTimeout(this.restart.bind(this), 1_000);
          console.debug(`Background process ${ this.name } will restart.`);
        }
      }).catch(console.error);
    });
  }

  /**
   * Stop the process and do not restart it.
   */
  async stop() {
    console.log(`Stopping background process ${ this.name }.`);
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.process) {
      await this.destroy(this.process);
    }
  }
}
