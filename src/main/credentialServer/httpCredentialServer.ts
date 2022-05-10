import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';
import childProcess from 'child_process';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import * as serverHelper from '@/main/serverHelper';
import { findHomeDir } from '@/config/findHomeDir';

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

type dispatchFunctionType = (helperName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

type checkFunctionOutputType = (stdout: string, stderr: string) => boolean;

function requireNoOutput(stdout: string, stderr: string): boolean {
  return !stdout && !stderr;
}

function requireJSONOutput(stdout: string, stderr: string): boolean {
  if (stderr) {
    return false;
  }
  try {
    JSON.parse(stdout);

    return true;
  } catch {}

  return false;
}

export class HttpCredentialServer {
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
    const statePath = path.join(paths.appHome, SERVER_FILE_BASENAME);

    await fs.promises.writeFile(statePath,
      JSON.stringify(this.stateInfo, undefined, 2),
      { mode: 0o600 });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.log(`Error: ${ err }`);
    });
    this.server.listen(SERVER_PORT, '127.0.0.1');
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
      const url = new URL(request.url as string, `http://${ request.headers.host }`);
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

  protected combineStrings(stdout: string, stderr: string): string {
    if (!stdout) {
      return stderr;
    } else if (!stderr) {
      return stdout;
    } else {
      return `${ stdout }\n\n${ stderr }}`;
    }
  }

  protected async doNamedCommand(outputChecker: checkFunctionOutputType, helperName: string, commandName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    let stdout: string;
    let stderr: string;

    try {
      ( { stdout, stderr } = this.runSyncInput(data, helperName, [commandName]));
      if (outputChecker(stdout, stderr)) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write(stdout);

        return await Promise.resolve();
      }
      stderr = this.combineStrings(stdout, stderr);
    } catch (err: any) {
      stderr = this.combineStrings(err.stdout ?? '', err.stderr ?? '');
    }
    console.debug(`credentialServer: ${ commandName }: writing back status 400, error: ${ stderr }`);
    response.writeHead(400, { 'Content-Type': 'text/plain' });
    response.write(stderr);

    return await Promise.resolve();
  }

  // Caller is responsible for catching exceptions if this file doesn't exist
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

  protected runSyncInput(data: string, command: string, args: string[]): { stdout: string, stderr: string } {
    try {
      // Only the *Sync methods in childProcess that run an external command take a string
      // directly as input. Setting up a readable stream around a string is a lot more work.
      const { stdout, stderr } = childProcess.spawnSync(command, args, { input: data, stdio: 'pipe' });

      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (err: any) {
      return { stdout: '', stderr: err.toString() };
    }
  }
}
