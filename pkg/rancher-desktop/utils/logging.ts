/**
 * Logging is a helper class to manage log files; they can be viewed in the
 * Troubleshooting tab in the UI.
 *
 * Usage:
 *
 * import Logging from '.../logging';
 *
 * // Logs are compatible with console.log():
 * const console = Logging.topic;
 * console.log('Normal logging');
 * console.debug('Debug only logging');
 *
 * // It's also possible to use log streams directly:
 * Logging.topic.stream.write(...);
 *
 * // We can also handle logs directly from their path:
 * fs.readFile(Logging.topic.path, ...);
 */

import { Console } from 'console';
import fs from 'fs';
import path from 'path';
import stream from 'stream';
import util from 'util';

import paths from '@pkg/utils/paths';

type consoleKey = 'log' | 'error' | 'info' | 'warn';
type logLevel = 'debug' | 'info';

let LOG_LEVEL: logLevel = 'info';

export function setLogLevel(level: logLevel): void {
  LOG_LEVEL = level;
}

export class Log {
  constructor(topic: string, directory = paths.logs) {
    this.path = path.join(directory, `${ topic }.log`);
    this.stream = fs.createWriteStream(this.path, { flags: 'w', mode: 0o600 });
    this.fdPromise = new Promise((resolve) => {
      this.stream.on('open', resolve);
    });
    // If we're running unit tests, output to the console rather than file.
    // However, _don't_ do so for end-to-end tests in Playwright.
    // We detect Playwright via the TEST_PARALLEL_INDEX environment variable.
    // See https://playwright.dev/docs/test-parallel#worker-index-and-parallel-index
    if (process.env.NODE_ENV === 'test' && !process.env.TEST_PARALLEL_INDEX) {
      this.console = globalThis.console;
    } else {
      this.console = new Console(this.stream);
    }
  }

  /** The path to the log file. */
  readonly path: string;

  /** A stream to write to the log file. */
  readonly stream: fs.WriteStream;

  /** The underlying console stream. */
  protected readonly console: Console;

  protected fdPromise: Promise<number>;

  _fdStream: Promise<stream.Writable> | undefined;

  /**
   * A stream to write to the log file, with the guarantee that it has a
   * valid fd; this is useful for passing to child_process.spawn().
   */
  get fdStream(): Promise<stream.Writable> {
    if (!this._fdStream) {
      this._fdStream = (new Promise<stream.Writable>((resolve, reject) => {
        this.stream.write('', (error) => {
          if (error) {
            reject(error);
          } else {
            resolve(this.stream);
          }
        });
      }));
    }

    return this._fdStream;
  }

  /** Print a log message to the log file; appends a new line as appropriate. */
  log(message: any, ...optionalParameters: any[]) {
    this.logWithDate('log', message, optionalParameters);
  }

  /** Print a log message to the log file; appends a new line as appropriate. */
  error(message: any, ...optionalParameters: any[]) {
    this.logWithDate('error', message, optionalParameters);
  }

  /** Print a log message to the log file; appends a new line as appropriate. */
  info(message: any, ...optionalParameters: any[]) {
    this.logWithDate('info', message, optionalParameters);
  }

  /** Print a log message to the log file; appends a new line as appropriate. */
  warn(message: any, ...optionalParameters: any[]) {
    this.logWithDate('warn', message, optionalParameters);
  }

  protected logWithDate(method: consoleKey, message: any, optionalParameters: any[]) {
    this.console[method](`%s: ${ message }`, new Date(), ...optionalParameters);
  }

  /**
   * Log with the given arguments, but only if debug logging is enabled.
   */
  debug(data: any, ...args: any[]) {
    if (LOG_LEVEL === 'debug') {
      this.log(data, ...args);
    }
  }

  async sync() {
    await util.promisify(fs.fsync)(await this.fdPromise);
  }
}

interface Module {
  [topic: string]: Log;
}

const logs = new Map<string, Log>();

// We export a Proxy, so that we can catch all accesses to any properties, and
// dynamically create a new log as necessary.  All property accesses on the
// Proxy get shunted to the `get()` method, which can handle it similar to
// Ruby's method_missing.
export default new Proxy<Module>({}, {
  get: (target, prop, receiver) => {
    if (typeof prop !== 'string') {
      return Reflect.get(target, prop, receiver);
    }

    if (!logs.has(prop)) {
      logs.set(prop, new Log(prop));
    }

    return logs.get(prop);
  },
});

/**
 * Delete any existing log files from the logging directory, with the exception
 * of those that are already in use by Rancher Desktop. Should only be run once
 * we are certain that this is the only instance of Rancher Desktop running on
 * the system, so that logs from another instance are not deleted.
 */
export function clearLoggingDirectory(): void {
  if (process.env.NODE_ENV === 'test' || process.type !== 'browser') {
    return;
  }

  const entries = fs.readdirSync(paths.logs, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.log')) {
      const topic = path.basename(entry.name, '.log');

      if (!logs.has(topic)) {
        fs.unlinkSync(path.join(paths.logs, entry.name));
      }
    }
  }
}

fs.mkdirSync(paths.logs, { recursive: true });
