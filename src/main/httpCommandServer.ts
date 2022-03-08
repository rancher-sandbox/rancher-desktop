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
const SERVER_PORT = 6107;
const SERVER_USERNAME = 'user';
const SERVER_FILE_BASENAME = 'rd-engine.json';

export default class HttpCommandServer {
  protected server = http.createServer();
  protected password = randomStr();
  protected stateInfo: ServerState = {
    user:     SERVER_USERNAME,
    password: this.password,
    port:     SERVER_PORT,
    pid:      process.pid,
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
    console.log('CLI server is now ready.');
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

    if (user !== SERVER_USERNAME || password !== this.password) {
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
// And trying to use `cryptoRandomString()` from crypto-random-string gives an error message
// indicating that it pulls in some `require` statements where `import` is required.

function randomStr(length = 16) {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  const num = '0123456789';
  const charSet = alpha + alpha.toUpperCase() + num;
  const charSetLength = charSet.length;
  const chars = [];

  while (length-- > 0) {
    chars.push(charSet[Math.floor(Math.random() * charSetLength)]);
  }

  return chars.join('');
}
