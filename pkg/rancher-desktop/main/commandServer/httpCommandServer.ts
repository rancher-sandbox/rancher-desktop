import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

import express from 'express';
import _ from 'lodash';

import { State } from '@pkg/backend/backend';
import type { Settings } from '@pkg/config/settings';
import type { TransientSettings } from '@pkg/config/transientSettings';
import type { DiagnosticsResultCollection } from '@pkg/main/diagnostics/diagnostics';
import { ExtensionMetadata } from '@pkg/main/extensions/types';
import mainEvents from '@pkg/main/mainEvents';
import { getVtunnelInstance } from '@pkg/main/networking/vtunnel';
import * as serverHelper from '@pkg/main/serverHelper';
import { Snapshot } from '@pkg/main/snapshots/types';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { RecursivePartial } from '@pkg/utils/typeUtils';

/**
 * Represents the current or desired state of the backend/main process.
 */
export type BackendState = {
  // The state of the VM/backend.
  vmState: State,
  // Whether the backend is locked. If true, changes cannot
  // be made by the user until it is unlocked.
  locked: boolean,
};

export type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
};

type DispatchFunctionType = (request: express.Request, response: express.Response, context: commandContext) => Promise<void>;
type HttpMethod = 'get' | 'put' | 'post';

const console = Logging.server;
const SERVER_PORT = 6107;
const SERVER_FILE_BASENAME = 'rd-engine.json';
const MAX_REQUEST_BODY_LENGTH = 4194304; // 4MiB

export class HttpCommandServer {
  protected vtun = getVtunnelInstance();
  protected server = http.createServer();
  protected app = express();
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

  protected dispatchTable: Record<HttpMethod, Record<string, readonly [number, DispatchFunctionType]>> = _.merge(
    {
      get: {
        '/v1/about':                 [1, this.about],
        '/v1/diagnostic_categories': [0, this.diagnosticCategories],
        '/v1/diagnostic_ids':        [0, this.diagnosticIDsForCategory],
        '/v1/diagnostic_checks':     [0, this.diagnosticChecks],
        '/v1/settings':              [0, this.listSettings],
        '/v1/settings/locked':       [0, this.listLockedSettings],
        '/v1/transient_settings':    [0, this.listTransientSettings],
        '/v1/backend_state':         [1, this.getBackendState],
      },
      post: { '/v1/diagnostic_checks': [0, this.diagnosticRunChecks] },
      put:  {
        '/v1/factory_reset':      [0, this.factoryReset],
        '/v1/propose_settings':   [0, this.proposeSettings],
        '/v1/settings':           [0, this.updateSettings],
        '/v1/shutdown':           [0, this.wrapShutdown],
        '/v1/transient_settings': [0, this.updateTransientSettings],
        '/v1/backend_state':      [1, this.setBackendState],
      },
    } as const,
    {
      get:  { '/v1/extensions': [1, this.listExtensions] },
      post: {
        '/v1/extensions/install':   [1, this.installExtension],
        '/v1/extensions/uninstall': [1, this.uninstallExtension],
      },
    } as const,
    {
      get:  { '/v1/snapshots': [0, this.listSnapshots] },
      post: {
        '/v1/snapshots':        [0, this.createSnapshot],
        '/v1/snapshot/restore': [0, this.restoreSnapshot],
      },
      delete: { '/v1/snapshots': [0, this.deleteSnapshot] },
    } as const,
  );

  constructor(commandWorker: CommandWorkerInterface) {
    this.commandWorker = commandWorker;
    mainEvents.handle('api-get-credentials', () => Promise.resolve(this.interactiveState));
  }

  async init() {
    const localHost = '127.0.0.1';

    // The peerPort and upstreamServerAddress port will need to match
    // this is crucial if we ever pick dynamic ports for upstreamServerAddress
    if (process.platform === 'win32') {
      this.vtun.addTunnel({
        name:                  'CLI Server',
        handshakePort:         17372,
        vsockHostPort:         17371,
        peerAddress:           localHost,
        peerPort:              SERVER_PORT,
        upstreamServerAddress: `${ localHost }:${ SERVER_PORT }`,
      });
    }
    const statePath = path.join(paths.appHome, SERVER_FILE_BASENAME);

    await fs.promises.mkdir(paths.appHome, { recursive: true });
    await fs.promises.writeFile(statePath,
      jsonStringifyWithWhiteSpace(this.externalState),
      { mode: 0o600 });

    this.server = this.app
      .disable('etag')
      .disable('x-powered-by')
      .use(this.handleCORS)
      .use(this.checkAuth)
      .listen(SERVER_PORT, localHost)
      .on('error', (err) => {
        console.log(`Error: ${ err }`);
      });

    this.setupRoutes();
    console.log('CLI server is now ready.');
  }

  /**
   * Set up HTTP routes for express.
   * This takes the information from the route decorators and applies it to the
   * express application, handling the extra routes for backwards compatibility
   * and API listings.
   */
  protected setupRoutes() {
    let maxVersion = 0;

    for (const [untypedMethod, data] of Object.entries(this.dispatchTable)) {
      const method = untypedMethod as HttpMethod;

      for (const [route, [since, handler]] of Object.entries(data)) {
        const [, versionString, path] = /^\/v(\d+)\/(.*)$/.exec(route) ?? [];
        const version = parseInt(versionString || '0', 10);

        if (!versionString || !path) {
          throw new Error(`Could not parse HTTP route ${ route }`);
        }
        maxVersion = Math.max(version, maxVersion);

        this.app[method](`/v${ version }/${ path }`, (req, resp, next) => {
          const context: commandContext = { interactive: resp.locals.interactive };

          handler.call(this, req, resp, context).catch(next);
        });

        // Add routes for older API versions
        for (let oldVersion = since; oldVersion < version; ++oldVersion) {
          this.app[method](`/v${ oldVersion }/${ path }`, (req, resp, next) => {
            this.invalidAPIVersionCall(version, req, resp).catch(next);
          });
        }
      }
    }

    // Add versioned endpoints that list API endpoints
    for (let listVersion = 0; listVersion <= maxVersion; ++listVersion) {
      this.app.get(`/v${ listVersion }`, (req, resp) => {
        this.listEndpoints(listVersion.toString(), req, resp);
      });
    }

    this.app.get('/', (req, resp) => {
      this.listEndpoints('', req, resp);
    });
    // Set up catch-all handler for customized HTTP 404 message.
    this.app.all('*', ({ method, path }, resp) => {
      console.log(`404: No handler for URL ${ method } ${ path }.`);
      resp.status(404).type('txt').send(`Unknown command: ${ method } ${ path }`);
    });

    // The error handler must be set after everything else.
    this.app.use(this.handleError.bind(this));
  }

  /** checkAuth is middleware to verify authentication. */
  protected checkAuth = (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const authHeader = request.headers.authorization ?? '';
    const userDB = {
      [this.externalState.user]:    this.externalState.password,
      [this.interactiveState.user]: this.interactiveState.password,
    };

    switch (serverHelper.basicAuth(userDB, authHeader)) {
    case this.externalState.user:
      response.locals.interactive = false;
      break;
    case this.interactiveState.user:
      response.locals.interactive = true;
      break;
    default:
      response.type('txt').sendStatus(401);

      return;
    }
    next();
  };

  /**
   * Calculate the headers needed for CORS, and set them on the response.
   */
  protected handleCORS(request: express.Request, response: express.Response, next: express.NextFunction): void {
    response.set({
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
      'Access-Control-Allow-Origin':  '*',
    });

    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
    } else {
      next();
    }
  }

  /**
   * handleError is middleware to handle unexpected errors, logging the error to
   * the log file and returning a simpler HTTP internal server error response.
   */
  protected handleError(err: Error, request: express.Request, response: express.Response, next: express.NextFunction): void {
    if (!err) {
      next();
    }

    console.log(`Error handling ${ request.path }`, err);
    response.type('txt').sendStatus(500);
  }

  protected diagnosticCategories(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const categories = this.commandWorker.getDiagnosticCategories(context);

    if (categories) {
      console.debug('diagnosticCategories: succeeded 200');
      response.type('json').status(200)
        .send(jsonStringifyWithWhiteSpace(categories));
    } else {
      console.debug('diagnosticCategories: failed 404');
      response.type('text').status(404)
        .send('No diagnostic categories found');
    }

    return Promise.resolve();
  }

  protected diagnosticIDsForCategory(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const url = new URL(`http://${ request.url }`);
    const searchParams = url.searchParams;
    const category = searchParams.get('category');

    if (!category) {
      console.debug('diagnostic_ids: failed 400');
      response.type('txt').status(400)
        .send('diagnostic_ids: no category specified');

      return Promise.resolve();
    }
    const checkIDs = this.commandWorker.getDiagnosticIdsByCategory(category, context);

    if (checkIDs) {
      console.debug('diagnostic_ids: succeeded 200');
      response.type('json').status(200)
        .send(jsonStringifyWithWhiteSpace(checkIDs));
    } else {
      console.debug('diagnostic_ids: failed 404');
      response.type('txt').status(404)
        .send(`No diagnostic checks found in category ${ category }`);
    }

    return Promise.resolve();
  }

  protected async diagnosticChecks(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const url = new URL(`http://localhost/${ request.url }`);
    const searchParams = url.searchParams;
    const category = searchParams.get('category');
    const id = searchParams.get('id');
    const checks = await this.commandWorker.getDiagnosticChecks(category, id, context);

    console.debug('diagnostic_checks: succeeded 200');
    response.type('json').status(200)
      .send(jsonStringifyWithWhiteSpace(checks));
  }

  protected async diagnosticRunChecks(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const results = await this.commandWorker.runDiagnosticChecks(context);

    console.debug('diagnostic_run: succeeded 200');
    response.status(200).type('json')
      .send(jsonStringifyWithWhiteSpace(results));
  }

  protected invalidAPIVersionCall(neededVersion: number, request: express.Request, response: express.Response): Promise<void> {
    const method = request.method;
    const path = request.path;
    const pathParts = path.split('/');

    const msg = `Invalid version "/${ pathParts[1] }" for endpoint "${ method } ${ path }" - use "/v${ neededVersion }/${ pathParts.slice(2).join('/') }"`;

    console.log(`Error handling ${ request.url }`, msg);
    response.status(400).type('txt').send(msg);

    return Promise.resolve();
  }

  protected about(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const msg = 'The API is currently at version 1, but is still considered internal and experimental, and is subject to change without any advance notice.';

    console.debug('about: succeeded 200');
    response.status(200).type('txt').send(msg);

    return Promise.resolve();
  }

  protected listSettings(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const settings = this.commandWorker.getSettings(context);

    if (settings) {
      console.debug('listSettings: succeeded 200');
      response.status(200).type('txt').send(settings);
    } else {
      console.debug('listSettings: failed 200');
      response.status(404).type('txt').send('No settings found');
    }

    return Promise.resolve();
  }

  protected listLockedSettings(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const settings = this.commandWorker.getLockedSettings(context);

    if (settings) {
      console.debug('listLockedSettings: succeeded 200');
      response.status(200).type('txt').send(settings);
    } else {
      console.debug('listLockedSettings: failed 404');
      response.status(404).type('txt').send('No locked settings found');
    }

    return Promise.resolve();
  }

  protected listEndpoints(version: string, request: express.Request, response: express.Response): Promise<void> {
    // Determine all API paths, possibly filtered by the requested version.
    const apiPaths: [Uppercase<HttpMethod>, string][] = [];
    let maxVersion = 0;

    for (const [method, data] of Object.entries(this.dispatchTable)) {
      for (const route of Object.keys(data)) {
        const [, commandVersion] = /\/v(\d+)\//.exec(route) ?? [];

        maxVersion = Math.max(parseInt(commandVersion, 10), maxVersion);
        if (version && version !== commandVersion) {
          continue;
        }

        apiPaths.push([method.toUpperCase() as Uppercase<HttpMethod>, route]);
      }
    }

    if (version) {
      // If version given, ensure the version endpoint itself is listed.
      apiPaths.push(['GET', `/v${ version }`]);
    } else {
      // If no version is given, provide the unversioned API to list APIs.
      apiPaths.push(['GET', '/']);
      for (let listVersion = 0; listVersion <= maxVersion; ++listVersion) {
        apiPaths.push(['GET', `/v${ listVersion }`]);
      }
    }

    this.sortFavoringGetMethod(apiPaths);
    console.debug('listEndpoints: succeeded 200');
    response.status(200).type('json')
      .send(JSON.stringify(apiPaths.map(entry => entry.join(' '))));

    return Promise.resolve();
  }

  protected sortFavoringGetMethod(returnedPaths: [Uppercase<HttpMethod>, string][]) {
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

  protected async readRequestSettings<T>(
    request: express.Request,
    functionName: string,
  ): Promise<[number, string] | RecursivePartial<T>> {
    const [data, payloadError, payloadErrorCode] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);

    if (payloadError) {
      return [payloadErrorCode, payloadError];
    }

    if (data.length === 0) {
      return [400, 'no settings specified in the request'];
    }

    try {
      const result = JSON.parse(data) ?? {};

      if (typeof result !== 'object') {
        return [400, 'settings payload is not an object'];
      }

      return result;
    } catch (err) {
      // TODO: Revisit this log stmt if sensitive values (e.g. PII, IPs, creds) can be provided via this command
      console.log(`${ functionName }: error processing JSON request block\n${ data }\n`, err);

      return [400, 'error processing JSON request block'];
    }
  }

  /**
   * Handle `PUT /v?/settings` requests.
   * Like the other methods, this method creates the request (here by reading the request body),
   * submits it to the provided CommandWorker, and writes back the appropriate status code
   * and data to the response object.
   *
   * The incoming payload is expected to be a subset of the settings.Settings object
   */
  async updateSettings(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    let error: string;
    let errorCode = 400;
    let result = '';
    const body = await this.readRequestSettings(request, 'updateSettings');

    if (Array.isArray(body)) {
      [errorCode, error] = body;
    } else {
      try {
        [result, error] = await this.commandWorker.updateSettings(context, body);
      } catch (ex) {
        console.error(`updateSettings: exception when updating:`, ex);
        errorCode = 500;
        error = 'internal error';
      }
    }

    if (error) {
      console.debug(`updateSettings: write back status ${ errorCode }, error: ${ error }`);
      response.status(errorCode).type('txt').send(error);
    } else {
      console.debug(`updateSettings: write back status 202, result: ${ result }`);
      response.status(202).type('txt').send(result);
    }
  }

  async proposeSettings(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    let error: string;
    let errorCode = 400;
    let result = '';
    const body = await this.readRequestSettings<Settings>(request, 'updateSettings');

    try {
      if (Array.isArray(body)) {
        [errorCode, error] = body;
      } else {
        [result, error] = await this.commandWorker.proposeSettings(context, body);
        console.error(`propose: ${ JSON.stringify(body) } -> ${ result }`);
      }
    } catch (ex) {
      console.error('proposedSettings: internal error:', ex);
      errorCode = 500;
      error = 'internal error';
    }
    if (error) {
      console.error(`proposeSettings: write back status ${ errorCode }, error: ${ error }`);
      response.status(errorCode).type('txt').send(error);
    } else {
      console.error(`proposeSettings: write back status 200, result: ${ result }`);
      response.status(200).type('json').send(result);
    }
  }

  async factoryReset(request: express.Request, response: express.Response, _: commandContext): Promise<void> {
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
      response.status(202).type('txt').send('Doing a full factory reset....');
      setImmediate(() => {
        this.closeServer();
        this.commandWorker.factoryReset(keepSystemImages);
      });
    } else {
      console.debug(`factoryReset: write back status 400, error: ${ error }`);
      response.status(400).type('txt').send(error);
    }
  }

  wrapShutdown(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    console.debug('shutdown: succeeded 202');
    response.status(202).type('txt').send('Shutting down.');
    setImmediate(() => {
      this.closeServer();
      this.commandWorker.requestShutdown(context);
    });

    return Promise.resolve();
  }

  closeServer() {
    this.server.close();
  }

  protected listTransientSettings(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const transientSettings = this.commandWorker.getTransientSettings(context);

    response.status(200).type('json').send(transientSettings);

    return Promise.resolve();
  }

  protected async updateTransientSettings(
    request: express.Request,
    response: express.Response,
    context: commandContext,
  ): Promise<void> {
    let error: string;
    let errorCode = 400;
    let result = '';
    const body = await this.readRequestSettings<TransientSettings>(request, 'updateTransientSettings');

    if (Array.isArray(body)) {
      [errorCode, error] = body;
    } else {
      try {
        [result, error] = await this.commandWorker.updateTransientSettings(context, body);
      } catch (ex) {
        console.error(`updateTransientSettings: exception when updating:`, ex);
        errorCode = 500;
        error = 'internal error';
      }
    }

    if (error) {
      console.debug(`updateTransientSettings: write back status ${ errorCode }, error: ${ error }`);
      response.status(errorCode).type('txt').send(error);
    } else {
      console.debug(`updateTransientSettings: write back status 202, result: ${ result }`);
      response.status(202).type('txt').send(result);
    }
  }

  protected async listExtensions(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const extensions = await this.commandWorker.listExtensions();

    response.status(200).type('json').send(extensions);
  }

  protected async installExtension(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const id = request.query.id ?? '';

    if (!id) {
      response.status(400).type('txt').send('Extension ID is required in the id= parameter.');
    } else if (typeof id !== 'string') {
      response.status(400).type('txt').send(`Invalid extension id ${ JSON.stringify(id) }: not a string.`);
    } else {
      response.writeProcessing();
      const { status, data } = await this.commandWorker.installExtension(id, 'install');

      if (data) {
        if (typeof data === 'string') {
          response.status(status).type('txt').send(data);
        } else {
          response.status(status).type('json').send(data);
        }
      } else {
        response.sendStatus(status);
      }
    }
  }

  protected async uninstallExtension(request: express.Request, response: express.Response): Promise<void> {
    const id = request.query.id ?? '';

    if (!id) {
      response.status(400).type('txt').send('Extension ID is required in the id= parameter.');
    } else if (typeof id !== 'string') {
      response.status(400).type('txt').send(`Invalid extension id ${ JSON.stringify(id) }: not a string.`);
    } else {
      response.writeProcessing();
      const { status, data: rawData } = await this.commandWorker.installExtension(id, 'uninstall');
      const data = rawData || `Deleted ${ id }`;

      if (data) {
        if (typeof data === 'string') {
          response.status(status).type('txt').send(data);
        } else {
          response.status(status).type('json').send(data);
        }
      } else {
        response.sendStatus(status);
      }
    }
  }

  protected getBackendState(_: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const backendState = this.commandWorker.getBackendState();

    console.debug('GET backend_state: succeeded 200');
    response.status(200).json(backendState);

    return Promise.resolve();
  }

  protected async setBackendState(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    let result = 'received backend state';
    let statusCode = 202;
    const [data] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);
    const state = JSON.parse(data);

    try {
      this.commandWorker.setBackendState(state);
    } catch (ex) {
      console.error(`error in setBackendState:`, ex);
      statusCode = 500;
      result = `internal error: ${ ex }`;
    }
    console.debug(`setBackendState: write back status ${ statusCode }, result: ${ result }`);
    response.status(statusCode).type('txt').send(result);

    return Promise.resolve();
  }

  protected async listSnapshots(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const snapshots = await this.commandWorker.listSnapshots(context);

    response.status(200).type('json').send(snapshots);
  }

  protected async createSnapshot(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    try {
      const [data, payloadError] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);

      if (payloadError) {
        response.status(400).type('txt').send('The snapshot is invalid');

        return;
      }

      const snapshot = JSON.parse(data);

      if (!snapshot.name) {
        response.status(400).type('txt').send('The name field is required');
      } else {
        await this.commandWorker.createSnapshot(context, snapshot);

        response.status(200).type('txt').send('Snapshot successfully created');
      }
    } catch (error: any) {
      if (error.isSnapshotError) {
        response.status(400).type('txt').send(error.message);
      } else {
        throw error;
      }
    }
  }

  protected async restoreSnapshot(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const id = request.query.id ?? '';

    if (!id) {
      response.status(400).type('txt').send('Snapshot id is required in query parameters');
    } else if (typeof id !== 'string') {
      response.status(400).type('txt').send(`Invalid snapshot id ${ JSON.stringify(id) }: not a string.`);
    } else {
      try {
        await this.commandWorker.restoreSnapshot(context, id);

        response.status(200).type('txt').send('Snapshot successfully restored');
      } catch (error: any) {
        if (error.isSnapshotError) {
          response.status(400).type('txt').send(error.message);
        } else {
          throw error;
        }
      }
    }
  }

  protected async deleteSnapshot(request: express.Request, response: express.Response, context: commandContext): Promise<void> {
    const id = request.query.id ?? '';

    if (!id) {
      response.status(400).type('txt').send('Snapshot id is required in query parameters');
    } else if (typeof id !== 'string') {
      response.status(400).type('txt').send(`Invalid snapshot id ${ JSON.stringify(id) }: not a string.`);
    } else {
      try {
        await this.commandWorker.deleteSnapshot(context, id);

        response.status(200).type('txt').send('Snapshot successfully deleted');
      } catch (error: any) {
        if (error.isSnapshotError) {
          response.status(400).type('txt').send(error.message);
        } else {
          throw error;
        }
      }
    }
  }
}

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
  getLockedSettings: (context: commandContext) => string;
  updateSettings: (context: commandContext, newSettings: RecursivePartial<Settings>) => Promise<[string, string]>;
  proposeSettings: (context: commandContext, newSettings: RecursivePartial<Settings>) => Promise<[string, string]>;
  requestShutdown: (context: commandContext) => void;
  getDiagnosticCategories: (context: commandContext) => string[]|undefined;
  getDiagnosticIdsByCategory: (category: string, context: commandContext) => string[]|undefined;
  getDiagnosticChecks: (category: string|null, checkID: string|null, context: commandContext) => Promise<DiagnosticsResultCollection>;
  runDiagnosticChecks: (context: commandContext) => Promise<DiagnosticsResultCollection>;
  getTransientSettings: (context: commandContext) => string;
  updateTransientSettings: (context: commandContext, newTransientSettings: RecursivePartial<TransientSettings>) => Promise<[string, string]>;
  /** Get the state of the backend */
  getBackendState: () => BackendState;
  /** Set the desired state of the backend */
  setBackendState: (state: BackendState) => void;

  // #region extensions
  /** List the installed extensions with their versions */
  listExtensions(): Promise<Record<string, {version: string, metadata: ExtensionMetadata, labels: Record<string, string>}>>;
  /**
   * Install or uninstall the given extension, returning an appropriate HTTP status code.
   * @param state Whether to install or uninstall the extension.
   * @returns The HTTP status code, possibly with arbitrary response body data.
   */
  installExtension(id: string, state: 'install' | 'uninstall'): Promise<{status: number, data?: any}>;
  // #endregion
  listSnapshots: (context: commandContext) => Promise<Snapshot[]>;
  createSnapshot: (context: commandContext, snapshot: Snapshot) => Promise<void>;
  deleteSnapshot: (context: commandContext, id: string) => Promise<void>;
  restoreSnapshot: (context: commandContext, id: string) => Promise<void>;
}

// Extend CommandWorkerInterface to have extra types, as these types are used by
// things that would need to use the interface.  ESLint doesn't like using
// namespaces; but in this case we're extending an existing interface.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CommandWorkerInterface {
  export type CommandContext = commandContext;
}
