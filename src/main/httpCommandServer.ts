import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';

export type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
}

type DispatchFunctionType = (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

const console = Logging.server;
const SERVER_PORT = 6107;
const SERVER_USERNAME = 'user';
const SERVER_FILE_BASENAME = 'rd-engine.json';

export class HttpCommandServer {
  protected server = http.createServer();
  protected password = randomStr();
  protected stateInfo: ServerState = {
    user:     SERVER_USERNAME,
    password: this.password,
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected commandWorker: CommandWorkerInterface | null = null;

  protected dispatchTable: Record<string, Record<string, Record<string, DispatchFunctionType>>> = {
    v0: {
      GET: { 'list-settings': this.listSettings },
      PUT: { shutdown: this.wrapShutdown, set: this.updateSettings },
    }
  };

  async init(commandWorker: CommandWorkerInterface) {
    const statePath = path.join(paths.appHome, SERVER_FILE_BASENAME);

    this.commandWorker = commandWorker;
    await fs.promises.writeFile(statePath,
      JSON.stringify(this.stateInfo, undefined, 2),
      { mode: 0o600 });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.log(`Error: ${ err }`);
    });
    this.server.listen(SERVER_PORT, '127.0.0.1');
    console.log('CLI server is now ready.');
  }

  protected async handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    try {
      if (!this.basicAuth(request.headers.authorization ?? '')) {
        response.writeHead(401, { 'Content-Type': 'text/plain' });

        return;
      }
      const method = request.method ?? 'GET';
      const url = new URL(request.url as string, `http://${ request.headers.host }`);
      const path = url.pathname;
      const pathParts = path.split('/');

      if (pathParts.shift()) {
        response.writeHead(40, { 'Content-Type': 'text/plain' });
        response.write(`Unexpected data before first / in URL ${ path }`);
      }
      const command = this.lookupCommand(pathParts[0], method, pathParts[1]);

      if (!command) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.write(`Unknown command: ${ method } ${ path }`);

        return;
      }
      await command.call(this, request, response);
    } catch (err) {
      console.log(`Error handling ${ request.url }: ${ err }`);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.write('Error processing request.');
    } finally {
      response.end();
    }
  }

  protected basicAuth(authString: string): boolean {
    if (!authString) {
      console.log('Auth failure: no username+password given');

      return false;
    }
    const m = /^Basic\s+(.*)/.exec(authString);

    if (!m) {
      console.log('Auth failure: only Basic auth is supported');

      return false;
    }
    const [user, password] = base64Decode(m[1])
      .split(':', 2);

    if (user !== SERVER_USERNAME || password !== this.password) {
      console.log(`Auth failure: user/password validation failure for attempted login of user ${ user }`);

      return false;
    }

    return true;
  }

  protected lookupCommand(version: string, method: string, commandName: string) {
    return this.dispatchTable[version]?.[method]?.[commandName];
  }

  async listSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return await new Promise((resolve) => {
      const settings = this.commandWorker?.getSettings();

      if (settings) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write(settings);
      } else {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.write('No settings found');
      }
      resolve();
    });
  }

  /**
   * Expect the parameters to come in both via URL parameters (non-traditional) and in a request body.
   * @param request
   * @param response
   */
  async updateSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url as string, `http://${ request.headers.host }`);
    const searchParams = url.searchParams;
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks).toString();
    const values = data ? JSON.parse(Buffer.concat(chunks).toString()) : {};

    for (const entry of searchParams.entries()) {
      values[entry[0]] = entry[1];
    }
    const [result, error] = await (this.commandWorker as CommandWorkerInterface).updateSettings(values);

    if (result) {
      console.log(`updateSettings: write back 202, result: ${ result }`);
      response.writeHead(202, { 'Content-Type': 'text/plain' });
      response.write(result);
    } else {
      console.log(`updateSettings: write back 400, error: ${ error }`);
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.write(error);
    }
  }

  async wrapShutdown(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return await new Promise((resolve) => {
      response.writeHead(202, { 'Content-Type': 'text/plain' });
      response.write('Shutting down.');
      setImmediate(() => {
        this.closeServer();
        this.commandWorker?.requestShutdown();
      });
      resolve();
    });
  }

  closeServer() {
    this.server.close();
  }
}

// TODO: Delete this comment during review:
// https://english.stackexchange.com/questions/56431/updatable-vs-updateable-which-is-correct
export type UpdatableSettings = Record<string, string|boolean>;

/**
 * Description of the methods which the HttpCommandServer uses to interact with the backend.
 * There's no need to use events because the server and the core backend run in the same process.
 * The HttpCommandServer is passed an instance of this interface, and calls the methods on it
 * in order to carry out the business logic for the requests it receives.
 */
export interface CommandWorkerInterface {
  getSettings: () => string;
  updateSettings: (newSettings: UpdatableSettings) => Promise<[string, string]>;
  requestShutdown: () => void;
}

function base64Decode(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}
// There's a `randomStr` in utils/string.ts but it's only usable from the UI side
// because it depends on access to the `window` object.
// And trying to use `cryptoRandomString()` from crypto-random-string gives an error message
// indicating that it pulls in some `require` statements where `import` is required.

function randomStr(length = 16) {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  const num = '0123456789';
  const charSet = alpha + alpha.toUpperCase() + num;
  const charSetLength = charSet.length;
  const chars = [];

  while (length-- > 0) {
    chars.push(charSet[Math.floor(Math.random() * charSetLength)]);
  }

  return chars.join('');
}
