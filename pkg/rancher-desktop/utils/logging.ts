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
    if (process.type === 'renderer') {
      topic = `${ topic }-renderer`;
    }
    this.path = path.join(directory, `${ topic }.log`);
    this.reopen();
    // The following lines only exist because TypeScript can't reason about
    // the call to this.reopen() correctly.  They are unused.
    this.realStream ??= fs.createWriteStream(this.path, { flags: 'ERROR' });
    this.console ??= globalThis.console;
    this.fdPromise ??= Promise.reject();
  }

  /** The path to the log file. */
  readonly path: string;

  /** A stream to write to the log file. */
  get stream(): fs.WriteStream {
    return this.realStream;
  }

  /** The underlying console stream. */
  protected console: Console;

  protected realStream: fs.WriteStream;

  /**
   * Reopen the logs; this is necessary after a factory reset because the files
   * would have been deleted from under us (so reopening ensures any new logs
   * are readable).
   * @note This is only used during E2E tests where we do a factory reset.
   */
  protected reopen(mode = 'w') {
    if ((process.env.RD_TEST ?? '').includes('e2e')) {
      // If we're running E2E tests, we may need to create the log directory.
      // We don't do this normally because it's synchronous and slow.
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }
    this.realStream?.close();
    this.realStream = fs.createWriteStream(this.path, { flags: mode, mode: 0o600 });
    this.fdPromise = new Promise((resolve) => {
      this.stream.on('open', resolve);
    });
    delete this._fdStream;

    // If we're running unit tests, output to the console rather than file.
    // However, _don't_ do so for end-to-end tests in Playwright.
    // We detect Playwright via an environment variable we set in scripts/e2e.ts
    if (process.env.NODE_ENV === 'test' && (process.env.RD_TEST ?? '').includes('e2e')) {
      this.console = globalThis.console;
    } else {
      this.console = new Console(this.stream);
    }
  }

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

  /**
   * Log with the given arguments, but only if debug logging is enabled.
   */
  debug(data: any, ...args: any[]) {
    if (LOG_LEVEL === 'debug') {
      this.log(data, ...args);
    }
  }

  /**
   * Log a description and an exception.  If running in development or in test,
   * include the exception logs.  This is useful for exceptions that are
   * somewhat expected, but can occasionally be relevant.
   */
  debugE(message: string, exception: any) {
    if (process.env.RD_TEST || process.env.NODE_ENV !== 'production') {
      this.debug(message, exception);
    } else {
      this.debug(`${ message } ${ exception }`);
    }
  }

  protected logWithDate(method: consoleKey, message: any, optionalParameters: any[]) {
    this.console[method](`%s: ${ message }`, new Date().toISOString(), ...optionalParameters);
  }

  async sync() {
    await util.promisify(fs.fsync)(await this.fdPromise);
  }
}

type Module = Record<string, Log>;

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
  if ((process.env.RD_TEST ?? '').includes('e2e') || process.type !== 'browser') {
    return;
  }

  const entries = fs.readdirSync(paths.logs, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.log')) {
      const topic = path.basename(entry.name, '.log');

      if (!logs.has(topic)) {
        const fullPath = path.join(paths.logs, entry.name);

        try {
          fs.unlinkSync(fullPath);
        } catch (ex: any) {
          console.log(`Failed to delete log file ${ fullPath }: ${ ex }`);
        }
      }
    }
  }
}

export function reopenLogs() {
  for (const log of logs.values()) {
    log['reopen']('a');
    // Trigger making the stream (by passing it to `Array.of()` and ignoring the
    // result).
    Array.of(log.fdStream);
  }
}

fs.mkdirSync(paths.logs, { recursive: true });
