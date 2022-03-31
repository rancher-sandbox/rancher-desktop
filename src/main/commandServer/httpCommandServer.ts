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
const MAX_REQUEST_BODY_LENGTH = 2048;

export class HttpCommandServer {
  protected server = http.createServer();
  protected password = randomStr();
  protected stateInfo: ServerState = {
    user:     SERVER_USERNAME,
    password: this.password,
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected commandWorker: CommandWorkerInterface;

  protected dispatchTable: Record<string, Record<string, Record<string, DispatchFunctionType>>> = {
    v0: {
      GET: { 'list-settings': this.listSettings },
      PUT: {
        shutdown: this.wrapShutdown,
        set:      this.updateSettings
      },
    }
  };

  constructor(commandWorker: CommandWorkerInterface) {
    this.commandWorker = commandWorker;
  }

  async init() {
    const statePath = path.join(paths.appHome, SERVER_FILE_BASENAME);

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
      console.debug(`Processing request.url ${ request.url as string }`);
      const path = url.pathname;
      const pathParts = path.split('/');

      console.debug(`Processing request ${ method } ${ path }`);
      if (pathParts.shift()) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.write(`Unexpected data before first / in URL ${ path }`);
      }
      const command = this.lookupCommand(pathParts[0], method, pathParts[1]);

      if (!command) {
        console.log(`404: No handler for URL ${ method } ${ path }.`);
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.write(`Unknown command: ${ method } ${ path }`);

        return;
      }
      await command.call(this, request, response);
    } catch (err) {
      console.log(`Error handling ${ request.url }`, err);
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

  listSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const settings = this.commandWorker.getSettings();

    if (settings) {
      console.debug('listSettings: succeeded 200');
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write(settings);
    } else {
      console.debug('listSettings: failed 200');
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.write('No settings found');
    }

    return Promise.resolve();
  }

  /**
   * Handle `PUT /v?/set` requests.
   * Like the other methods, this method creates the request (here by reading the request body),
   * submits it to the provided CommandWorker, and writes back the appropriate status code
   * and data to the response object.
   *
   * The incoming payload is expected to be a subset of the settings.Settings object
   */
  async updateSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let values: Record<string, any> = {};
    let result = '';
    let error = '';
    let dataSize = 0;

    // Read in the request body
    for await (const chunk of request) {
      dataSize += chunk.toString().length;
      if (dataSize > MAX_REQUEST_BODY_LENGTH) {
        error = `request body is too long, request body size exceeds ${ MAX_REQUEST_BODY_LENGTH }`;
        break;
      }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks).toString();

    if (data.length === 0) {
      error = 'no settings specified in the request';
    } else if (!error) {
      try {
        console.debug(`Request data: ${ data }`);
        values = JSON.parse(data);
      } catch (err) {
        // TODO: Revisit this log stmt if sensitive values (e.g. PII, IPs, creds) can be provided via this command
        console.log(`updateSettings: error processing JSON request block\n${ data }\n`, err);
        error = 'error processing JSON request block';
      }
    }
    if (!error) {
      [result, error] = await this.commandWorker.updateSettings(values);
    }

    if (error) {
      console.debug(`updateSettings: write back status 400, error: ${ error }`);
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.write(error);
    } else {
      console.debug(`updateSettings: write back status 202, result: ${ result }`);
      response.writeHead(202, { 'Content-Type': 'text/plain' });
      response.write(result);
    }
  }

  wrapShutdown(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    console.debug('shutdown: succeeded 202');
    response.writeHead(202, { 'Content-Type': 'text/plain' });
    response.write('Shutting down.');
    setImmediate(() => {
      this.closeServer();
      this.commandWorker.requestShutdown();
    });

    return Promise.resolve();
  }

  closeServer() {
    this.server.close();
  }
}

/**
 * Description of the methods which the HttpCommandServer uses to interact with the backend.
 * There's no need to use events because the server and the core backend run in the same process.
 * The HttpCommandServer is passed an instance of this interface, and calls the methods on it
 * in order to carry out the business logic for the requests it receives.
 */
export interface CommandWorkerInterface {
  getSettings: () => string;
  updateSettings: (newSettings: Record<string, any>) => Promise<[string, string]>;
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
