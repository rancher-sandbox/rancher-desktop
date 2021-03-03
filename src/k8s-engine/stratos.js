'use strict';
/**
 * This package starts stratos
 */

import childProcess from 'child_process';
import path from 'path';
import util from 'util';
import { app } from 'electron';
import XDGAppPaths from 'xdg-app-paths';
import resources from '../resources';

const paths = XDGAppPaths({ name: 'rancher-desktop' });

export default class Stratos {
  /**
   * Construct a new stratos instance
   * @param {import("../config/settings").Settings["stratos"]} settings
   */
  constructor(settings) {
    this.settings = settings;
  }

  get executable() {
    return resources.executable('jetstream');
  }

  /** @type {childProcess.ChildProcess} */
  #process = null;

  /**
   * @returns {childProcess.ChildProcess}
   */
  get process() {
    if (this.#process && this.#process.exitCode === null) {
      return this.#process;
    }

    // TODO: packaged builds
    const srcDir = path.resolve(__dirname, '..', '..');
    const configDir = path.resolve(srcDir, 'dist', 'stratos');
    const env = {
      ...process.env,
      AUTH_ENDPOINT_TYPE:          'none',
      CONSOLE_PROXY_TLS_ADDRESS:   ':',
      CONSOLE_PROXY_CERT_GENERATE: true,
      DATABASE_PROVIDER:           'sqlite',
      ENCRYPTION_KEY:              this.settings.encryptionKey,
      HELM_CACHE_FOLDER:           path.resolve(paths.data(), 'helm-cache'),
      SESSION_STORE_EXPIRY:        5000,
      SKIP_SSL_VALIDATION:         true,
      SQLITE_DB_DIR:               paths.data(),
      SQLITE_KEEP_DB:              true,
      UI_PATH:                     configDir,
    };

    const options = {
      env,
      cwd:   path.join(srcDir, 'src', 'stratos', 'src', 'jetstream'),
      stdio: 'inherit',
    };

    if (app.isPackaged) {
      Object.assign(env, {
        CONSOLE_PROXY_CERT_PATH:     '',
        CONSOLE_PROXY_CERT_KEY_PATH: '',
      });
      Object.assign(options, { cwd: process.resourcesPath });
    }

    console.log({ ...options, executable: this.executable });
    this.#process = childProcess.spawn(this.executable, options);
    this.#process.on('exit', () => {
      this.#process = null;
    });

    return this.#process;
  }

  shutdown() {
    this.#process?.kill();
  }

  /**
   * Parse a single line of output from `lsof -F0tPn`
   * @param {string} line A line of output from `lsof` with the expected arguments.
   */
  #parseLsofLine(line) {
    const result = {};
    const fields = line.split('\0').filter(x => x);

    for (const field of fields) {
      const { prefix, value } = /^(?<prefix>.)(?<value>.*)$/.exec(field)?.groups ?? {};

      switch (prefix) {
      case 'p': result.pid = value; break;
      case 'f': result.fd = value; break;
      case 't': result.type = value; break;
      case 'P': result.protocol = value; break;
      case 'n': result.name = value; break;
      case 'T': {
        const [tcpKey, tcpValue] = value.split('=', 2);

        result[`TCP_${ tcpKey }`] = tcpValue;
      }
      }
    }

    return result;
  }

  /**
   * Get the port that Stratos is listening on
   * @returns {Promise<number>}
   */
  get port() {
    return (async() => {
      const execFile = util.promisify(childProcess.execFile);

      for (;;) {
        const { stdout } = await execFile('lsof', [`-p${ this.process.pid }`, '-F0tPnT', '-nP']);
        const entries = stdout.split(/\n/).map(this.#parseLsofLine);
        const entry = entries.find((entry) => {
          return entry.type?.startsWith('IP') &&
        entry.protocol === 'TCP' &&
        entry.TCP_ST === 'LISTEN';
        });

        if (entry) {
          console.log('Found stratos port', { entry });

          return parseInt((/^.*?:(\d+)$/.exec(entry.name))[1], 10) ;
        }
        console.log('Could not find jetstream port, retrying...');
        await util.promisify(setTimeout)(500);
      }
    })();
  }
}
