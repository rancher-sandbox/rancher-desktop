import fs from 'fs';
import http from 'http';
import path from 'path';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';

type ServerState = {
  user: string;
  password: string;
  port: number;
  pid: number;
}

const console = Logging.server;
const ServerPort = 6107;
const ServerUsername = 'user';
const ServerFileBasename = 'rd-engine.json';

export default class HttpCommandServer {
  protected server = http.createServer();
  protected password = randomStr();
  protected stateInfo: ServerState = {
    user:     ServerUsername,
    password: this.password,
    port:     ServerPort,
    pid:      process.pid,
  };

  async init() {
    const statePath = path.join(paths.appHome, ServerFileBasename);

    await fs.promises.writeFile(statePath,
      JSON.stringify(this.stateInfo, undefined, 2),
      { mode: 0o600 });
    this.server.listen(ServerPort, '127.0.0.1');
    console.log(`Listening on port ${ ServerPort }, user: ${ ServerUsername },  password: ${ this.password }`);
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('error', (err) => {
      console.log(`Error: ${ err }`);
    });
  }

  shutdown() {
    this.server.close();
  }

  protected handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    if (!this.basicAuth(request.headers.authorization ?? '')) {
      response.writeHead(401, { 'Content-Type': 'text/plain' });
    } else {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('Nothing to see here yet.');
    }
    response.end();
  }

  protected basicAuth(authString: string): boolean {
    if (!authString) {
      console.log('Auth failure: no username+password given');

      return false;
    }
    const m = /^Basic\s+(.*)/.exec(authString);

    if (!m) {
      console.log('Auth failure: only Basic auth is supported');

      return false;
    }
    const [user, password] = base64Decode(m[1])
      .split(':', 2);

    if (user !== ServerUsername || password !== this.password) {
      console.log(`Auth failure: user/password validation failure for attempted login of user ${ user }`);

      return false;
    }

    return true;
  }
}

function base64Decode(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}
// There's a `randomStr` in utils/string.ts but it's only usable from the UI side
// because it depends on access to the `window` object.

function randomStr(length = 16) {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  const num = '0123456789';
  const safeSym = '@%_+-=,.'; // chars that don't cause problems on the command-line
  const charSet = alpha + alpha.toUpperCase() + num + safeSym;
  const charSetLength = charSet.length;
  const chars = [];

  while (length-- > 0) {
    chars.push(charSet[Math.round(Math.random() * charSetLength)]);
  }

  return chars.join('');
}
