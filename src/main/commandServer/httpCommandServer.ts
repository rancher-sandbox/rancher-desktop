import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import * as serverHelper from '@/main/serverHelper';

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
  protected password = serverHelper.randomStr();
  protected stateInfo: ServerState = {
    user:     SERVER_USERNAME,
    password: this.password,
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected commandWorker: CommandWorkerInterface;

  protected dispatchTable: Record<string, Record<string, Record<string, DispatchFunctionType>>> = {
    v0: {
      GET: { settings: this.listSettings },
      PUT: {
        shutdown: this.wrapShutdown,
        settings: this.updateSettings
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
      if (!serverHelper.basicAuth(SERVER_USERNAME, this.password, request.headers.authorization ?? '')) {
        response.writeHead(401, { 'Content-Type': 'text/plain' });

        return;
      }
      const method = request.method ?? 'GET';
      const url = new URL(request.url as string, `http://${ request.headers.host }`);
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

  protected lookupCommand(version: string, method: string, commandName: string) {
    if (commandName) {
      return this.dispatchTable[version]?.[method]?.[commandName];
    }
    if (version === '' || version in this.dispatchTable) {
      return this.listEndpoints.bind(this, version);
    }

    return undefined;
  }

  protected listSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
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

  protected getPathsForVersion(version: string, returnedPaths: Array<string[]>): Array<string[]> {
    const paths = this.dispatchTable[version];

    returnedPaths.push(['GET', `/${ version }`]);
    for (const method in paths) {
      for (const path in paths[method]) {
        returnedPaths.push([method, ['', version, path].join('/')]);
      }
    }

    return returnedPaths;
  }

  protected listEndpoints(version: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const returnedPaths: Array<string[]> = [];

    if (version) {
      this.getPathsForVersion(version, returnedPaths);
    } else {
      returnedPaths.push(['GET', '/']);
      for (const version in this.dispatchTable) {
        this.getPathsForVersion(version, returnedPaths);
      }
    }
    this.sortFavoringGetMethod(returnedPaths);
    console.debug('listEndpoints: succeeded 200');
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write(JSON.stringify(returnedPaths.map(entry => entry.join(' '))));

    return Promise.resolve();
  }

  protected sortFavoringGetMethod(returnedPaths: Array<string[]>) {
    returnedPaths.sort(([methodA, pathA], [methodB, pathB]) => {
      if (pathA === pathB) {
        if (methodA === 'GET') {
          return methodB === 'GET' ? 0 : -1;
        } else if (methodB === 'GET') {
          return 1;
        } else {
          return methodA.localeCompare(methodB);
        }
      }

      return pathA.localeCompare(pathB);
    });
  }

  /**
   * Handle `PUT /v?/settings` requests.
   * Like the other methods, this method creates the request (here by reading the request body),
   * submits it to the provided CommandWorker, and writes back the appropriate status code
   * and data to the response object.
   *
   * The incoming payload is expected to be a subset of the settings.Settings object
   */
  async updateSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    let values: Record<string, any> = {};
    let result = '';
    const [data, payloadError] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);
    let error = '';

    if (data.length === 0) {
      error = 'no settings specified in the request';
    } else if (!payloadError) {
      try {
        console.debug(`Request data: ${ data }`);
        values = JSON.parse(data);
      } catch (err) {
        // TODO: Revisit this log stmt if sensitive values (e.g. PII, IPs, creds) can be provided via this command
        console.log(`updateSettings: error processing JSON request block\n${ data }\n`, err);
        error = 'error processing JSON request block';
      }
    } else {
      error = payloadError;
    }
    if (!payloadError && !error) {
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
