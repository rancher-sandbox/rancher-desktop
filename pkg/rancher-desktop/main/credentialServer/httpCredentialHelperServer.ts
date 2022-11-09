import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import stream from 'stream';
import { URL } from 'url';

import { findHomeDir } from '@kubernetes/client-node';

import { getVtunnelInstance } from '@/main/networking/vtunnel';
import * as serverHelper from '@/main/serverHelper';
import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { jsonStringifyWithWhiteSpace } from '@/utils/stringify';

export type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
};

const SERVER_PORT = 6109;
const console = Logging.server;
const SERVER_USERNAME = 'user';
const SERVER_FILE_BASENAME = 'credential-server.json';
const MAX_REQUEST_BODY_LENGTH = 4194304; // 4MiB

type credHelperInfo = {
  credsStore: string;
  credHelpers: Record<string, string>
};

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
  return !s || /\n$/.test(s) ? s : `${ s }\n`;
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
      const helperInfo = await this.getCredentialHelperName(commandName, data);

      if (commandName === 'list') {
        await this.doListCommand(helperInfo, request, response);
      } else {
        await this.doNonListCommand(`docker-credential-${ helperInfo.credsStore }`, commandName, data, request, response);
      }
    } catch (err) {
      console.debug(`FAILURE: Processing request ${ request.method } ${ path }`);
      console.log(`Error handling ${ request.url }`, err);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.write('Error processing request.');
    } finally {
      response.end();
    }
  }

  protected async doNonListCommand(
    helperName: string,
    commandName: string,
    data: string,
    request: http.IncomingMessage,
    response: http.ServerResponse): Promise<void> {
    try {
      const stdout = await this.runCommand(helperName, commandName, data, request);

      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write(ensureEndsWithNewline(stdout));
    } catch (err: any) {
      const stderr = (err.stderr || err.stdout) ?? err.toString();

      console.debug(`FAILURE: Processing request ${ commandName } with credential helper ${ helperName }`);
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.write(ensureEndsWithNewline(stderr));
    }
  }

  protected async runCommand(helperName: string,
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
    const checkerFn: checkerFnType|undefined = checkers[commandName];

    if (request.method !== 'POST') {
      requestCheckError = `Expecting a POST method for the credential-server list request, received ${ request.method }`;
    } else if (!checkerFn) {
      requestCheckError = `Unknown credential action '${ commandName }' for the credential-server, must be one of [${ Object.keys(checkers).sort().join('|') }]`;
    }
    if (requestCheckError) {
      throw new Error(requestCheckError);
    }

    const platform = os.platform();
    let pathVar = process.env.PATH ?? '';

    // The PATH needs to contain our resources directory (on macOS that would
    // not be in the application's PATH), as well as /usr/local/bin.
    // NOTE: This needs to match DockerDirManager.spawnFileWithExtraPath
    pathVar += path.delimiter + path.join(paths.resources, platform, 'bin');
    if (platform === 'darwin') {
      pathVar += `${ path.delimiter }/usr/local/bin`;
    }

    const body = stream.Readable.from(data);
    const { stdout } = await childProcess.spawnFile(helperName, [commandName], {
      env:   { ...process.env, PATH: pathVar },
      stdio: [body, 'pipe', console],
    });

    if (!checkerFn(stdout)) {
      throw new Error(`Invalid output for ${ commandName } command.`);
    }

    return stdout;
  }

  /**
   * For the LIST command, there are multiple possible sources of information
   * that need to be merged into a simple
   *    { ServerURL: Username } hash.
   * The first source is the credsStore.
   * Then if any helper credsStores are identified in the `credHelpers` section,
   * get the full { ServerURL: Username } from each of them,
   * and keep only those ServerURLs that point to that credsStore.
   *
   * Modeled after https://github.com/docker/cli/blob/d0bd373986b6678bfe1a0eb6989ce13907247a85/cli/config/configfile/file.go#L285
   *
   * @param {String} credsStore: global credential-helper-name defined in ~/.docker/config.json
   * @param {Record<string, string>} credHelpers: hash of URLs to credential-helper-name
   * @param {http.IncomingMessage} request:
   * @param {http.ServerResponse} response:
   */
  protected async doListCommand(
    { credsStore, credHelpers }: credHelperInfo,
    request: http.IncomingMessage,
    response: http.ServerResponse): Promise<void> {
    try {
      const serverAndUsernameInfo: Record<string, string> =
        JSON.parse(await this.runCommand(`docker-credential-${ credsStore }`,
          'list', '', request));
      const helperNames = new Set(Object.values(credHelpers ?? {}));

      for (const helperName of helperNames) {
        try {
          const helperServerAndUserNames: Record<string, string> =
            JSON.parse(await this.runCommand(`docker-credential-${ helperName }`,
              'list', '', request));

          for (const serverURL in helperServerAndUserNames) {
            if (credHelpers[serverURL] === helperName) {
              serverAndUsernameInfo[serverURL] = helperServerAndUserNames[serverURL];
            }
          }
        } catch (err) {
          console.debug(`Failed to get credential list for helper ${ helperName }`);
        }
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write(JSON.stringify(serverAndUsernameInfo));

      return;
    } catch (err: any) {
      const stderr = err.stderr || err.stdout || err.toString();

      console.debug(`credentialServer: list: writing back status 400, error: ${ stderr }`);
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.write(stderr);
    }
  }

  /**
   * Returns the name of the credential-helper to use (which is a suffix of the helper `docker-credential-`).
   *
   * Note that callers are responsible for catching exceptions, which usually happens if the
   * `$HOME/docker/config.json` doesn't exist, its JSON is corrupt, or it doesn't have a `credsStore` field.
   */
  protected async getCredentialHelperName(command: string, payload: string): Promise<credHelperInfo> {
    const home = findHomeDir();
    const dockerConfig = path.join(home ?? '', '.docker', 'config.json');
    const contents = JSON.parse((await fs.promises.readFile(dockerConfig, { encoding: 'utf-8' })).toString());
    const credHelpers = contents.credHelpers;
    const credsStore = contents.credsStore;

    if (credHelpers) {
      let credsStoreOverride = '';

      switch (command) {
      case 'erase':
      case 'get':
        credsStoreOverride = credHelpers[payload.trim()];
        break;
      case 'store': {
        const obj = JSON.parse(payload);

        credsStoreOverride = obj.ServerURL ? credHelpers[obj.ServerURL] : '';
      }
      }
      if (credsStoreOverride) {
        return { credsStore: credsStoreOverride, credHelpers: { } };
      }
    }

    return { credsStore, credHelpers };
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
