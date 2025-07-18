import http from 'http';

import Logging from '@pkg/utils/logging';

const console = Logging.server;

export function basicAuth(userdb: Record<string, string>, authString: string): string | false {
  if (!authString) {
    console.log('Auth failure: no username+password given');

    return false;
  }
  const m = /^Basic\s+(.*)/i.exec(authString);

  if (!m) {
    console.log('Auth failure: only Basic auth is supported');

    return false;
  }
  const [user, ...passwordParts] = base64Decode(m[1]).split(':');
  const password = passwordParts.join(':');

  if (!(user in userdb)) {
    console.log(`Auth failure: unknown user ${ user } specified.`);

    return false;
  }
  if (userdb[user] === password) {
    return user;
  }
  console.log(`Auth failure: user/password validation failure for attempted login of user ${ user }`);

  return false;
}

function base64Decode(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}

/**
 * Reads in the input from the request body (which is done by calling `for await (const chunk of result)`),
 * verifies it hasn't exceeded the max-allowed size,
 * and returns it as a string.
 *
 * @param request
 * @param maxPayloadSize
 * @return [value: string, error: string]
 */
export async function getRequestBody(request: http.IncomingMessage, maxPayloadSize: number): Promise<[string, string, number]> {
  const chunks: Buffer[] = [];
  let error = '';
  let errorCode = 200;
  let dataSize = 0;

  // Read in the request body
  for await (const chunk of request) {
    dataSize += chunk.length;
    if (dataSize > maxPayloadSize) {
      if (errorCode === 200) {
        error = `request body is too long, request body size exceeds ${ maxPayloadSize }`;
        errorCode = 413;
      }
      // Do not break out of the loop -- you need to stay to consume the rest of the input.
    } else {
      chunks.push(chunk);
    }
  }
  const data = Buffer.concat(chunks).toString();

  return [data, error, errorCode];
}

// There's a `randomStr` in utils/string.ts but it's only usable from the UI side
// because it depends on access to the `window` object.
// And trying to use `cryptoRandomString()` from crypto-random-string gives an error message
// indicating that it pulls in some `require` statements where `import` is required.

export function randomStr(length = 16) {
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
