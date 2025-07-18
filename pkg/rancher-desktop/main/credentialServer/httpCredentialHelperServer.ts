import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

import runCredentialHelper from './credentialUtils';

import * as serverHelper from '@pkg/main/serverHelper';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';

export interface ServerState {
  user:     string;
  password: string;
  port:     number;
  pid:      number;
}

const SERVER_PORT = 6109;
const console = Logging.server;
const SERVER_USERNAME = 'user';
const SERVER_FILE_BASENAME = 'credential-server.json';
const MAX_REQUEST_BODY_LENGTH = 4194304; // 4MiB

type checkerFnType = (stdout: string) => boolean;

function requireNoOutput(stdout: string): boolean {
  return !stdout;
}

function requireNonEmptyOutput(stdout: string): boolean {
  return !!stdout.length;
}

function requireJSONOutput(stdout: string): boolean {
  try {
    JSON.parse(stdout);

    return true;
  } catch {
  }

  return false;
}

export function getServerCredentialsPath(): string {
  return path.join(paths.appHome, SERVER_FILE_BASENAME);
}

function ensureEndsWithNewline(s: string) {
  return !s || s.endsWith('\n') ? s : `${ s }\n`;
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

  protected listenAddr = '127.0.0.1';

  async init() {
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
      if (serverHelper.basicAuth({ [SERVER_USERNAME]: this.password }, request.headers.authorization ?? '') !==
        SERVER_USERNAME) {
        response.writeHead(401, { 'Content-Type': 'text/plain' });

        return;
      }
      const url = new URL(request.url ?? '', `http://${ request.headers.host }`);
      const path = url.pathname;
      const pathParts = path.split('/');

      if (pathParts.shift()) {
        console.debug(`FAILURE: Processing request ${ request.method } ${ path }`);
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.write(`Unexpected data before first / in URL ${ path }`);

        return;
      }
      const commandName = pathParts[0];
      const [data, error, errorCode] = await serverHelper.getRequestBody(request, MAX_REQUEST_BODY_LENGTH);

      if (error) {
        console.debug(`FAILURE: Processing request ${ request.method } ${ path }`);
        console.debug(`${ path }: write back status ${ errorCode }, error: ${ error }`);
        response.writeHead(errorCode, { 'Content-Type': 'text/plain' });
        response.write(error);

        return;
      }

      await this.doCommand(commandName, data, request, response);
    } catch (err) {
      console.debug(`FAILURE: Processing request ${ request.method } ${ path }`);
      console.log(`Error handling ${ request.url }`, err);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.write('Error processing request.');
    } finally {
      response.end();
    }
  }

  protected async doCommand(
    commandName: string,
    data: string,
    request: http.IncomingMessage,
    response: http.ServerResponse): Promise<void> {
    try {
      const stdout = await this.runCommand(commandName, data, request);

      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write(ensureEndsWithNewline(stdout));
    } catch (err: any) {
      const stderr = (err.stderr || err.stdout) ?? err.toString();
      const helperName = err.helper ?? '<unknown>';

      console.debug(`FAILURE: Processing request ${ commandName } with credential helper ${ helperName }`);
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.write(ensureEndsWithNewline(stderr));
    }
  }

  protected async runCommand(
    commandName: string,
    data: string,
    request: http.IncomingMessage): Promise<string> {
    let requestCheckError: any = null;
    const checkers: Record<string, checkerFnType> = {
      list:  requireJSONOutput,
      // When pass starts throwing an exception for a failed 'get', this can change from
      // requireNonEmptyOutput to requireJSONOutput, and requireNonEmptyOutput can be deleted.
      get:   requireNonEmptyOutput,
      erase: requireNoOutput,
      store: requireNoOutput,
    };
    const checkerFn: checkerFnType | undefined = checkers[commandName];

    if (request.method !== 'POST') {
      requestCheckError = `Expecting a POST method for the credential-server list request, received ${ request.method }`;
    } else if (!checkerFn) {
      requestCheckError = `Unknown credential action '${ commandName }' for the credential-server, must be one of [${ Object.keys(checkers).sort().join('|') }]`;
    }
    if (requestCheckError) {
      throw new Error(requestCheckError);
    }

    const output = await runCredentialHelper(commandName, data);

    if (!checkerFn(output)) {
      throw new Error(`Invalid output for ${ commandName } command.`);
    }

    return output;
  }

  closeServer() {
    this.server.close();
  }
}
