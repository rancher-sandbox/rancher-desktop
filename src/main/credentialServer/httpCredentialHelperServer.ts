import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import { URL } from 'url';
import childProcess from 'child_process';
import util from 'util';

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
    const statePath = getServerCredentialsPath();

    await fs.promises.writeFile(statePath,
      JSON.stringify(this.stateInfo, undefined, 2),
      { mode: 0o600 });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.error(`Error writing out ${ statePath }`, err);
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

  protected async doNamedCommand(outputChecker: checkFunctionOutputType,
    helperName: string,
    commandName: string,
    data: string,
    request: http.IncomingMessage,
    response: http.ServerResponse): Promise<void> {
    let stderr: string;

    try {
      const stdout = await this.runWithInput(data, helperName, [commandName]);

      console.log(`QQQ: output for ${ commandName }: ${ stdout }`);
      if (outputChecker(stdout)) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write(stdout);

        return await Promise.resolve();
      }
      console.log(`QQQ: outputChecker failed, setting to stderr\n`);
      stderr = stdout;
    } catch (err: any) {
      console.log(`QQQ: caught command ${ commandName }, err: ${ err },\n full error:\n`, err);
      stderr = err.stderr ?? err.stdout ?? '';
    }
    console.debug(`credentialServer: ${ commandName }: writing back status 400, error: ${ stderr }`);
    response.writeHead(400, { 'Content-Type': 'text/plain' });
    response.write(stderr);

    return await Promise.resolve();
  }

  /**
   * Returns the name of the credential-helper to use (which is a suffix of the helper `docker-credential-`).
   *
   * Note that callers are responsible for catching exceptions, which usually happen if the
   * `$HOME/docker/config.json` doesn't exist, it's JSON is corrupt, or it doesn't have a `credsStore` field.
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

  protected runWithInput(data: string, command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: childProcess.SpawnOptions = {};

      if (os.platform().startsWith('win')) {
        options.windowsHide = true;
      }
      const proc = childProcess.spawn(command, args, options);
      const stdoutArray: string[] = [];
      const stderrArray: string[] = [];
      let code = 0;
      let signal = '';

      proc.stdout?.on('data', (data) => {
        console.log(`stdout data: ${ typeof data.toString() }`);
        console.log(`stdout data: ${ data }`);
        stdoutArray.push(data.toString());
      });

      proc.stderr?.on('data', (data) => {
        console.log(`stderr data: ${ typeof data.toString() }`);
        console.log(`stderr data: ${ data }`);
        stderrArray.push(data.toString());
      });

      proc.on('error', (data) => {
        console.log(`error data: ${ typeof data.toString() }`);
        reject({ stderr: data.toString() });
        // stderrs.push(data.toString());
      });

      proc.on('close', (_code: number, _signal: string) => {
        console.log(`QQQ: got close with code ${ _code }/signal ${ _signal }`);
        code = _code;
        signal = _signal;
      });

      proc.on('exit', (_code: number) => {
        if (_code && !code) {
          code = _code;
        }
        console.log(`QQQ: got exit with code ${ _code }`);
        if (!code && !signal) {
          resolve(stdoutArray.join(''));
        } else {
          reject({ stderr: combineOutputs(stdoutArray.join(''), stderrArray.join('')) });
        }
      });

      // No need to wait on the input side -- the `exit` event shouldn't be emitted
      // until process.stdin gets an `end` event.
      this.provideInputAsChunks(proc, data).catch((err) => {
        console.log(`Error writing to the ${ command } process: ${ err }`);
        // Probably don't need to reject on this event -- wait for an error or exit event
        // on the main process.
      });
    });
  }

  protected async provideInputAsChunks(proc: childProcess.ChildProcess, input: string): Promise<void> {
    const chunks = input.match(/.{1,256}/g) || [];

    if ((chunks[0] ?? '').length > 0) {
      proc.stdin?.write(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await util.promisify(setTimeout)(100);
        proc.stdin?.write(chunk);
      }
    }
    proc.stdin?.end();
  }
}

function combineOutputs(stdout: string, stderr: string) {
  return [stdout, stderr].filter(x => !!x).join('\n\n');
}
