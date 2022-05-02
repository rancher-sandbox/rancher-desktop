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

export class HttpCredentialServer {
  protected server = http.createServer();
  protected password = serverHelper.randomStr();
  protected stateInfo: ServerState = {
    user:     SERVER_USERNAME,
    password: this.password,
    port:     SERVER_PORT,
    pid:      process.pid,
  };

  protected dispatchTable: Record<string, Record<string, boolean>> = {
    GET: {
      get:   true,
      store: true,
      erase: true,
      list:  true,
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
      const method = request.method ?? 'GET';
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
      if (!this.lookupCommand(method, pathParts[0])) {
        console.log(`404: No handler for URL ${ method } ${ path }.`);
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.write(`Unknown command: ${ method } ${ path }`);

        return;
      }
      await this.doNamedCommand(helperName, pathParts[0], data, request, response);
    } catch (err) {
      console.log(`Error handling ${ request.url }`, err);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.write('Error processing request.');
    } finally {
      response.end();
    }
  }

  protected lookupCommand(method: string, commandName: string) {
    if (commandName) {
      return this.dispatchTable[method]?.[commandName];
    }

    return undefined;
  }

  protected async doNamedCommand(helperName: string, commandName: string, data: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    let stdout = '';
    let stderr: string;

    try {
      ( { stdout, stderr } = this.runSyncInput(data, helperName, [commandName]));
      if (!stderr) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write(stdout);

        return await Promise.resolve();
      }
    } catch (err: any) {
      stderr = err.stderr?.toString() || err.stdout?.toString();
    }
    console.debug(`credentialServer: ${ commandName }: writing back status 400, error: ${ stderr || '' }`);
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
      const stdout = childProcess.execFileSync(command, args, { input: data });

      return { stdout: stdout.toString(), stderr: '' };
    } catch (err: any) {
      return { stdout: '', stderr: err.toString() };
    }
  }
}
