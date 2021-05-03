/**
 * Logging is a helper class to manage log files; they can be viewed in the
 * Troubleshooting tab in the UI.
 *
 * Usage:
 *
 * import Logging from '.../logging';
 *
 * const topicLog = Logging('topic');
 * await Logging.topic('Log string goes here');
 * // Equivalent to `await topicLog.log('Log string goes here');
 * // The class has a `path` member:
 * fs.readFile(Logging.topic.path, ...);
 */

import fs from 'fs';
import path from 'path';
import stream from 'stream';

import XDGAppPaths from 'xdg-app-paths';
const paths = XDGAppPaths({ name: 'rancher-desktop' });
const logDir = path.join(paths.runtime() || paths.state(), 'logs');

interface Log {
  (message: string): Promise<void>;
  path: string;
  stream: stream.Writable;
}

interface Module {
  (topic: string): Log;
  [topic: string]: Log;
}

/**
 * This is both the function to return logs, as well as holding references to
 * all existing logs.  It does double-duty to make the API a bit nicer for
 * consumers.
 */
const logging = function(topic: string) {
  if (!(topic in logging)) {
    const logPath = path.join(logDir, `${ topic }.log`);
    const fileStream = fs.createWriteStream(logPath, { flags: 'a', mode: 0o600 });

    logging[topic] = async function(message: string) {
      await new Promise<void>((resolve, reject) => {
        fileStream.write(message, (error) => {
          error ? reject(error) : resolve();
        });
      });
    } as Log;
    logging[topic].path = logPath;
    logging[topic].stream = fileStream;
  }

  return logging[topic];
} as Module;

export default new Proxy(logging, {
  get: (target, prop, receiver) => {
    if (typeof prop !== 'string') {
      return Reflect.get(target, prop, receiver);
    }

    const result: Log = (prop in target) ? target[prop] : target(prop);

    return result;
  }
});

/**
 * Initialize logging, removing all existing logs.  This is only done in the
 * main process, and due to how imports work, only ever called once.
 * Unforunately, this must be done synchronously to avoid deleting log files
 * that are newly created.
 */
// The main process is 'browser', as opposed to 'renderer'.
if (process.type === 'browser') {
  fs.mkdirSync(logDir, { recursive: true });
  for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.log')) {
      fs.unlinkSync(path.join(logDir, entry.name));
    }
  }
}
