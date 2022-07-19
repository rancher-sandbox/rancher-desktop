import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import stream from 'stream';
import { URL } from 'url';

import { getVtunnelInstance } from '@/main/networking/vtunnel';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import * as childProcess from '@/utils/childProcess';
import * as serverHelper from '@/main/serverHelper';
import { findHomeDir } from '@/config/findHomeDir';
import { jsonStringifyWithWhiteSpace } from '@/utils/stringify';

export type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
}

const SERVER_PORT = 6109;
const console = Logging.server;
const SERVER_USERNAME = 'user';
const SERVER_FILE_BASENAME = 'credential-server.json';
const MAX_REQUEST_BODY_LENGTH = 4194304; // 4MiB

type dispatchFunctionType = (helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

type checkFunctionOutputType = (stdout: string) => boolean;

function requireNoOutput(stdout: string): boolean {
  return !stdout;
}

function requireJSONOutput(stdout: string): boolean {
  try {
    JSON.parse(stdout);

    return true;
  } catch { }

  return false;
}

export function getServerCredentialsPath(): string {
  return path.join(paths.appHome, SERVER_FILE_BASENAME);
}

export class HttpCredentialHelperServer {
  protected vtun = getVtunnelInstance();
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

  protected listenAddr = '127.0.0.1';

  async init() {
    if (process.platform === 'win32') {
      this.vtun.addTunnel({
        name:                  'Credential Server',
        handshakePort:         17362,
        vsockHostPort:         17361,
        peerAddress:           this.listenAddr,
        peerPort:              3030,
        upstreamServerAddress: `${ this.listenAddr }:${ SERVER_PORT }`,
      });
    }
    const statePath = getServerCredentialsPath();

    await fs.promises.writeFile(statePath,
      jsonStringifyWithWhiteSpace(this.stateInfo),
      { mode: 0o600 });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.error(`Error writing out ${ statePath }`, err);
    });
    this.server.listen(SERVER_PORT, this.listenAddr);
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
      const [data, error, errorCode] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);

      if (error) {
        console.debug(`${ path }: write back status ${ errorCode }, error: ${ error }`);
        response.writeHead(errorCode, { 'Content-Type': 'text/plain' });
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

  protected lookupCommand(method: string, commandName: string): dispatchFunctionType | undefined {
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
    let error: any;

    try {
      const platform = os.platform();
      let pathVar = process.env.PATH ?? '';

      // The PATH needs to contain our resources directory (on macOS that would
      // not be in the application's PATH), as well as /usr/local/bin.
      // NOTE: This needs to match DockerDirManager.
      pathVar += path.delimiter + path.join(paths.resources, platform, 'bin');
      if (platform === 'darwin') {
        pathVar += `${ path.delimiter }/usr/local/bin`;
      }

      const body = stream.Readable.from(data);
      const { stdout } = await childProcess.spawnFile(helperName, [commandName], {
        env:   { ...process.env, PATH: pathVar },
        stdio: [body, 'pipe', console]
      });

      if (outputChecker(stdout)) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write(stdout);

        return;
      }
      stderr = stdout;
    } catch (err: any) {
      stderr = err.stderr || err.stdout;
      error = err;
    }
    console.debug(`credentialServer: ${ commandName }: writing back status 400, error: ${ stderr || error }`);
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
    const credsStore = contents['credsStore'];

    if (!credsStore) {
      throw new Error(`No credsStore field in ${ dockerConfig }`);
    }

    return credsStore;
  }

  closeServer() {
    this.server.close();
  }

  protected async runWithInput(data: string, command: string, args: string[]): Promise<string> {
    const body = stream.Readable.from(data);
    const { stdout } = await childProcess.spawnFile(command, args, { stdio: [body, 'pipe', console] });

    return stdout;
  }
}
