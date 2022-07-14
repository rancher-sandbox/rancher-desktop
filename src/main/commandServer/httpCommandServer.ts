import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

import type { Settings } from '@/config/settings';
import mainEvents from '@/main/mainEvents';
import * as serverHelper from '@/main/serverHelper';
import { getVtunnelInstance } from '@/main/networking/vtunnel';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { jsonStringifyWithWhiteSpace } from '@/utils/stringify';
import { RecursivePartial } from '@/utils/typeUtils';

export type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
}

type DispatchFunctionType = (request: http.IncomingMessage, response: http.ServerResponse, context: commandContext) => Promise<void>;

const console = Logging.server;
const SERVER_PORT = 6107;
const SERVER_FILE_BASENAME = 'rd-engine.json';
const MAX_REQUEST_BODY_LENGTH = 4194304; // 4MiB

export class HttpCommandServer {
  protected vtun = getVtunnelInstance();
  protected server = http.createServer();
  protected readonly externalState: ServerState = {
    user:     'user',
    password: serverHelper.randomStr(),
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected readonly interactiveState: ServerState = {
    user:     'interactive-user',
    password: serverHelper.randomStr(),
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected commandWorker: CommandWorkerInterface;

  protected dispatchTable: Record<string, Record<string, Record<string, DispatchFunctionType>>> = {
    v0: {
      GET: { settings: this.listSettings },
      PUT: {
        factory_reset: this.factoryReset,
        shutdown:      this.wrapShutdown,
        settings:      this.updateSettings
      },
    }
  };

  constructor(commandWorker: CommandWorkerInterface) {
    this.commandWorker = commandWorker;
    mainEvents.on('api-get-credentials', () => {
      mainEvents.emit('api-credentials', this.interactiveState);
    });
  }

  async init() {
    const localHost = '127.0.0.1';

    if (process.platform === 'win32') {
      this.vtun.addTunnel({
        name:                  'CLI Server',
        handshakePort:         17372,
        vsockHostPort:         17371,
        peerAddress:           localHost,
        peerPort:              4040,
        upstreamServerAddress: `${ localHost }:${ SERVER_PORT }`,
      });
    }
    const statePath = path.join(paths.appHome, SERVER_FILE_BASENAME);

    await fs.promises.writeFile(statePath,
      jsonStringifyWithWhiteSpace(this.externalState),
      { mode: 0o600 });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.log(`Error: ${ err }`);
    });
    this.server.listen(SERVER_PORT, localHost);
    console.log('CLI server is now ready.');
  }

  protected checkAuth(request: http.IncomingMessage): UserType | false {
    const authHeader = request.headers.authorization ?? '';

    if (serverHelper.basicAuth(this.externalState.user, this.externalState.password, authHeader)) {
      return 'api';
    }
    if (serverHelper.basicAuth(this.interactiveState.user, this.interactiveState.password, authHeader)) {
      return 'interactive';
    }

    return false;
  }

  /**
   * Calculate the headers needed for CORS, and sets them on the response.
   * @returns true if the request has been completely handled.
   */
  protected handleCORS(request: http.IncomingMessage, response: http.ServerResponse): boolean {
    response.setHeader('Access-Control-Allow-Headers', 'Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT');
    response.setHeader('Access-Control-Allow-Origin', '*');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);

      return true;
    }

    return false;
  }

  protected async handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    try {
      if (this.handleCORS(request, response)) {
        return;
      }
      const userType = this.checkAuth(request);

      if (!userType) {
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
      await command.call(this, request, response, { interactive: userType === 'interactive' });
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

  protected listSettings(request: http.IncomingMessage, response: http.ServerResponse, context: commandContext): Promise<void> {
    const settings = this.commandWorker.getSettings(context);

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
  async updateSettings(request: http.IncomingMessage, response: http.ServerResponse, context: commandContext): Promise<void> {
    let values: Record<string, any> = {};
    let result = '';
    const [data, payloadError, payloadErrorCode] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);
    let error = '';
    let errorCode = 400;

    if (payloadError) {
      error = payloadError;
      errorCode = payloadErrorCode;
    } else if (data.length === 0) {
      error = 'no settings specified in the request';
    } else {
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
      [result, error] = await this.commandWorker.updateSettings(context, values);
    }

    if (error) {
      console.debug(`updateSettings: write back status ${ errorCode }, error: ${ error }`);
      response.writeHead(errorCode, { 'Content-Type': 'text/plain' });
      response.write(error);
    } else {
      console.debug(`updateSettings: write back status 202, result: ${ result }`);
      response.writeHead(202, { 'Content-Type': 'text/plain' });
      response.write(result);
    }
  }

  async factoryReset(request: http.IncomingMessage, response: http.ServerResponse, _: commandContext): Promise<void> {
    let values: Record<string, any> = {};
    const [data, payloadError] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);
    let error = '';
    let keepSystemImages = false;

    if (!payloadError) {
      try {
        console.debug(`Request data: ${ data }`);
        values = JSON.parse(data);
        if ('keepSystemImages' in values) {
          keepSystemImages = values.keepSystemImages;
        }
      } catch (err) {
        // TODO: Revisit this log stmt if sensitive values (e.g. PII, IPs, creds) can be provided via this command
        console.log(`updateSettings: error processing JSON request block\n${ data }\n`, err);
        error = 'error processing JSON request block';
      }
    } else {
      error = payloadError;
    }
    if (!error) {
      console.debug('factory reset: succeeded 202');
      response.writeHead(202, { 'Content-Type': 'text/plain' });
      response.write('Doing a full factory reset....');
      setImmediate(() => {
        this.closeServer();
        this.commandWorker.factoryReset(keepSystemImages);
      });
    } else {
      console.debug(`updateSettings: write back status 400, error: ${ error }`);
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.write(error);
    }
  }

  wrapShutdown(request: http.IncomingMessage, response: http.ServerResponse, context: commandContext): Promise<void> {
    console.debug('shutdown: succeeded 202');
    response.writeHead(202, { 'Content-Type': 'text/plain' });
    response.write('Shutting down.');
    setImmediate(() => {
      this.closeServer();
      this.commandWorker.requestShutdown(context);
    });

    return Promise.resolve();
  }

  closeServer() {
    this.server.close();
  }
}

type UserType = 'api' | 'interactive';
interface commandContext {
  interactive: boolean;
}

/**
 * Description of the methods which the HttpCommandServer uses to interact with the backend.
 * There's no need to use events because the server and the core backend run in the same process.
 * The HttpCommandServer is passed an instance of this interface, and calls the methods on it
 * in order to carry out the business logic for the requests it receives.
 */
export interface CommandWorkerInterface {
  factoryReset: (keepSystemImages: boolean) => void;
  getSettings: (context: commandContext) => string;
  updateSettings: (context: commandContext, newSettings: RecursivePartial<Settings>) => Promise<[string, string]>;
  requestShutdown: (context: commandContext) => void;
}

// Extend CommandWorkerInterface to have extra types, as these types are used by
// things that would need to use the interface.  ESLint doesn't like using
// namespaces; but in this case we're extending an existing interface.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CommandWorkerInterface {
  export type CommandContext = commandContext;
}
