import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import stream from 'stream';
import { URL } from 'url';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { spawnFile } from '@/utils/childProcess';
import * as serverHelper from '@/main/serverHelper';
import { findHomeDir } from '@/config/findHomeDir';
import { wslHostIPv4Address } from '@/utils/networks';
import { jsonStringifyWithWhiteSpace } from '@/utils/stringify';

export type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
}

const console = Logging.server;
const SERVER_PORT = 6109;
const SERVER_USERNAME = 'user';
const SERVER_FILE_BASENAME = 'credential-server.json';
const MAX_REQUEST_BODY_LENGTH = 2048;
const isWindows = os.platform().startsWith('win');

type dispatchFunctionType = (helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

type checkFunctionOutputType = (stdout: string) => boolean;

function requireNoOutput(stdout: string): boolean {
  return !stdout;
}

function requireJSONOutput(stdout: string): boolean {
  try {
    JSON.parse(stdout);

    return true;
  } catch {}

  return false;
}

export function getServerCredentialsPath(): string {
  return path.join(paths.appHome, SERVER_FILE_BASENAME);
}

export class HttpCredentialHelperServer {
  protected server = http.createServer();
  protected password = serverHelper.randomStr();
  protected stateInfo: ServerState = {
    user:     SERVER_USERNAME,
    password: this.password,
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected dispatchTable: Record<string, Record<string, dispatchFunctionType>> = {
    POST: {
      get:   this.get,
      store: this.store,
      erase: this.erase,
      list:  this.list,
    },
  };

  async init() {
    let addr: string|undefined = '127.0.0.1';
    const statePath = getServerCredentialsPath();

    await fs.promises.writeFile(statePath,
      jsonStringifyWithWhiteSpace(this.stateInfo),
      { mode: 0o600 });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.error(`Error writing out ${ statePath }`, err);
    });
    if (isWindows) {
      addr = wslHostIPv4Address();
      if (!addr) {
        console.error('Failed to get an IP address for WSL subsystems.');
        addr = '127.0.0.1';
      }
    }
    this.server.listen(SERVER_PORT, addr);
    console.log('Credentials server is now ready.');
  }

  protected async handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    try {
      if (!serverHelper.basicAuth(SERVER_USERNAME, this.password, request.headers.authorization ?? '')) {
        response.writeHead(401, { 'Content-Type': 'text/plain' });

        return;
      }
      const helperName = `docker-credential-${ await this.getCredentialHelperName() }`;
      const method = request.method ?? 'POST';
      const url = new URL(request.url ?? '', `http://${ request.headers.host }`);
      const path = url.pathname;
      const pathParts = path.split('/');
      const [data, error] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);

      if (error) {
        console.debug(`${ path }: write back status 400, error: ${ error }`);
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.write(error);

        return;
      }
      console.debug(`Processing request ${ method } ${ path }`);
      if (pathParts.shift()) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.write(`Unexpected data before first / in URL ${ path }`);
      }
      const command = this.lookupCommand(method, pathParts[0]);

      if (!command) {
        console.log(`404: No handler for URL ${ method } ${ path }.`);
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.write(`Unknown command: ${ method } ${ path }`);

        return;
      }
      await command.call(this, helperName, data, request, response);
    } catch (err) {
      console.log(`Error handling ${ request.url }`, err);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.write('Error processing request.');
    } finally {
      response.end();
    }
  }

  protected lookupCommand(method: string, commandName: string): dispatchFunctionType|undefined {
    if (commandName) {
      return this.dispatchTable[method]?.[commandName];
    }

    return undefined;
  }

  async get(helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return await this.doNamedCommand(requireJSONOutput, helperName, 'get', data, request, response);
  }

  async list(helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return await this.doNamedCommand(requireJSONOutput, helperName, 'list', data, request, response);
  }

  async erase(helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return await this.doNamedCommand(requireNoOutput, helperName, 'erase', data, request, response);
  }

  async store(helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return await this.doNamedCommand(requireNoOutput, helperName, 'store', data, request, response);
  }

  protected async doNamedCommand(outputChecker: checkFunctionOutputType,
    helperName: string,
    commandName: string,
    data: string,
    request: http.IncomingMessage,
    response: http.ServerResponse): Promise<void> {
    let stderr: string;

    try {
      const body = stream.Readable.from(data);
      const { stdout } = await spawnFile(helperName, [commandName], { stdio: [body, 'pipe', console] });

      if (outputChecker(stdout)) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write(stdout);

        return;
      }
      stderr = stdout;
    } catch (err: any) {
      stderr = err.stderr || err.stdout || '';
    }
    console.debug(`credentialServer: ${ commandName }: writing back status 400, error: ${ stderr }`);
    response.writeHead(400, { 'Content-Type': 'text/plain' });
    response.write(stderr);
  }

  /**
   * Returns the name of the credential-helper to use (which is a suffix of the helper `docker-credential-`).
   *
   * Note that callers are responsible for catching exceptions, which usually happen if the
   * `$HOME/docker/config.json` doesn't exist, its JSON is corrupt, or it doesn't have a `credsStore` field.
   */
  protected async getCredentialHelperName(): Promise<string> {
    const home = findHomeDir();
    const dockerConfig = path.join(home ?? '', '.docker', 'config.json');
    const contents = JSON.parse((await fs.promises.readFile(dockerConfig, { encoding: 'utf-8' })).toString());
    const credStore = contents['credsStore'];

    if (!credStore) {
      throw new Error(`No credStore field in ${ dockerConfig }`);
    }

    return credStore;
  }

  closeServer() {
    this.server.close();
  }

  protected async runWithInput(data: string, command: string, args: string[]): Promise<string> {
    const body = stream.Readable.from(data);
    const { stdout } = await spawnFile(command, args, { stdio: [body, 'pipe', console] });

    return stdout;
  }
}
