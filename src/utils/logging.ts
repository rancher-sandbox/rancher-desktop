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
const logDir = path.join(paths.runtime() || paths.data(), 'logs');

fs.mkdir(logDir, { recursive: true }, () => undefined);

interface Log {
  (message: string): Promise<void>;
  path: string;
  stream: stream.Writable;
}

interface Module {
  (topic: string): Log;
  [topic: string]: Log;
}

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

// Load all existing log files
(async function() {
  for (const entry of await fs.promises.readdir(logDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) {
      continue;
    }
    logging(entry.name.replace(/\.log$/, ''));
  }
})();

export default new Proxy(logging, {
  get: (target, prop, receiver) => {
    if (typeof prop !== 'string') {
      return Reflect.get(target, prop, receiver);
    }

    const result: Log = (prop in target) ? target[prop] : target(prop);

    return result;
  }
});
