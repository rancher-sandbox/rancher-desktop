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

import Electron from 'electron';

// Removed prefix path due an error on
// playwright/test class - see https://github.com/microsoft/playwright/issues/7121
import paths from '../utils/paths';

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
    this.console = new Console(this.stream);
  }

  /** The path to the log file. */
  readonly path: string;

  /** A stream to write to the log file. */
  readonly stream: fs.WriteStream;

  /** The underlying console stream. */
  protected readonly console: Console;

  _fdStream: Promise<stream.Writable> | undefined;

  /**
   * A stream to write to the log file, with the guarantee that it has a
   * valid fd; this is useful for passing to child_process.spawn().
   */
  get fdStream() {
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
  }
});

/**
 * Initialize logging, removing all existing logs.  This is only done in the
 * main process, and due to how imports work, only ever called once.
 *
 * This is only done if we have the electron single-instance lock, as we do not
 * want to delete logs for existing instances - this should not be an issue, as
 * we will quit shortly.
 */

if (process.env.NODE_ENV === 'test') {
  // If we're running under test, just always ensure the directory can be used.
  fs.mkdirSync(paths.logs, { recursive: true });
} else if (process.type === 'browser') {
  // The main process is 'browser', as opposed to 'renderer'.
  // We can do this asynchronously, since we know which logs have been opened.
  // However, we still need to create the directory synchronously.
  if (Electron.app.requestSingleInstanceLock()) {
    fs.mkdirSync(paths.logs, { recursive: true });
    (async() => {
      const entries = await fs.promises.readdir(paths.logs, { withFileTypes: true });

      entries.map(async(entry) => {
        if (entry.isFile() && entry.name.endsWith('.log')) {
          const topic = path.basename(entry.name, '.log');

          if (!logs.has(topic)) {
            await fs.promises.unlink(path.join(paths.logs, entry.name));
          }
        }
      });
    })();
  }
}
