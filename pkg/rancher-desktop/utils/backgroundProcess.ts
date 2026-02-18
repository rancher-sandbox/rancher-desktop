import timers from 'timers';
import util from 'util';

import * as childProcess from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';

const console = Logging.background;

interface BackgroundProcessConstructorOptions {
  /** A function to create the underlying child process. */
  spawn:      () => Promise<childProcess.ChildProcess>;
  /** Optional function to stop the underlying child process. */
  destroy?:   (child: childProcess.ChildProcess | null) => Promise<void>;
  /** Additional checks to see if the process should be started. */
  shouldRun?: () => Promise<boolean>;
}

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
  protected timer: NodeJS.Timeout | undefined;

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
   * Check if the monitored process is still running.
   */
  protected isRunning() {
    return this.process?.exitCode === null && this.process.signalCode === null;
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
    timers.clearTimeout(this.timer);
    this.timer = undefined;

    if (this.process) {
      if (this.isRunning()) {
        console.debug(`Restarting ${ this.name } (pid ${ this.process.pid }): ignoring restart, already alive`);

        return;
      }
      console.debug(`Stopping existing ${ this.name } process (pid ${ this.process.pid })`);
      await this.destroy(this.process);

      // Wait for the process to fully exit
      while (this.isRunning()) {
        await util.promisify(timers.setTimeout)(100);
      }
    }

    console.log(`Launching background process ${ this.name }.`);
    const process = await this.spawn();

    this.process = process;
    console.debug(`Launched background process ${ this.name } (pid ${ process.pid })`);
    process.on('exit', (status, signal) => {
      if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
        console.log(`Background process ${ this.name } (pid ${ process.pid }) exited gracefully.`);
      } else {
        console.log(`Background process ${ this.name } (pid ${ process.pid }) exited with status ${ status } signal ${ signal }`);
      }
      if (!Object.is(process, this.process)) {
        console.log(`Not current ${ this.name } process (pid ${ process.pid }, want ${ this.process?.pid }); nothing to be done.`);

        return;
      }
      this.shouldRun().then((result) => {
        if (result) {
          this.timer = timers.setTimeout(() => {
            this.restart().catch(ex => console.error(ex));
          }, 1_000);
          console.debug(`Background process ${ this.name } will restart (process ${ process.pid } exited)`);
        }
      }).catch(console.error);
    });
  }

  /**
   * Stop the process and do not restart it.
   */
  async stop() {
    console.log(`Stopping background process ${ this.name } (pid ${ this.process?.pid ?? '<none>' }).`);
    this.started = false;
    timers.clearTimeout(this.timer);
    this.timer = undefined;
    await this.destroy(this.process);
  }
}
