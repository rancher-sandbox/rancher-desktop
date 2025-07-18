import runCredentialCommand from '@pkg/main/credentialServer/credentialUtils';
import fetch, { Headers } from '@pkg/utils/fetch';
import Logging from '@pkg/utils/logging';

const console = Logging.background;

interface tokenCacheEntry {
  /** The expiry of this token, as milliseconds since Unix epoch. */
  expiry: number;
  /** The raw token. */
  token:  string;
}

/**
 * RegistryAuth handles HTTP authentication for the registries
 */
class RegistryAuth {
  /**
   * A cache of still-valid tokens, keyed by (registry) host.
   */
  protected tokenCache: Record<string, tokenCacheEntry> = {};

  /**
   * Ask the credential helpers for authentication for the given host.
   * @param hosts The hosts to find auth for; possibly a URL instead.
   * @returns The value of the `Authorization` header to use.
   */
  protected async findAuth(...hosts: string[]): Promise<string | undefined> {
    const candidates: string[] = [];
    const hostCandidates: string[] = [];
    const suffixes = ['/', ''];

    for (const host of hosts) {
      if (!host) {
        continue;
      }
      if (host.includes('://')) {
        // This is a full URL, parse it.
        const url = new URL(host);

        candidates.push(host);
        hostCandidates.push(url.host, url.hostname);
        suffixes.push(url.pathname);
      } else {
        hostCandidates.push(host);
      }
    }

    if (hostCandidates.some(h => h === 'docker.io' || h.endsWith('.docker.io'))) {
      // Special handling for docker (typically, `https://auth.docker.io/token`).
      hostCandidates.push('index.docker.io');
      suffixes.push('/v1/');
    }

    for (const protocol of ['http', 'https']) {
      for (const hostPart of hostCandidates) {
        for (const suffix of suffixes) {
          candidates.push(`${ protocol }://${ hostPart }${ suffix }`);
        }
      }
    }

    let knownAuths: Record<string, { Username: string, Secret: string }> = {};

    try {
      knownAuths = JSON.parse(await runCredentialCommand('list'));
    } catch (ex) {
      // if we fail to list credentials, that's not an error (there's probably
      // no docker config or something).
      console.debug(`Failed to list known credentials: ${ ex }`);

      return;
    }

    for (const candidate of candidates) {
      if (candidate in knownAuths) {
        try {
          const auth = JSON.parse(await runCredentialCommand('get', candidate));
          const login = Buffer.from(`${ auth.Username }:${ auth.Secret }`, 'utf-8');

          return `Basic ${ login.toString('base64') }`;
        } catch {
          // Failure to get credentials from one helper isn't fatal.
          continue;
        }
      }
    }
  }

  /**
   * HTTP Basic Authentication
   */
  protected async basicAuth(host: string): Promise<Record<string, string>> {
    const auth = await this.findAuth(host);

    if (auth) {
      return { Authorization: auth };
    }

    throw new Error(`Could not find auth for ${ host }`);
  }

  /**
   * HTTP Bearer Authentication
   * @param host The host we're trying to authenticate against
   * @param parameters The WWW-Authenticate header parameters.
   */
  protected async bearerAuth(host: string, parameters: Record<string, string>): Promise<Record<string, string>> {
    // If we have a token in the cache, return it.
    if (host in this.tokenCache) {
      const cachedToken = this.tokenCache[host];

      if (cachedToken.expiry > Date.now()) {
        return { Authorization: `Bearer ${ cachedToken.token }` };
      }
      delete this.tokenCache[host];
    }

    const url = new URL(parameters.realm ?? (host.includes('://') ? host : `https://${ host }`));
    const auth = await this.findAuth(parameters.realm, host);
    const headers: Record<string, string> = auth ? { Authorization: auth } : {};

    if (parameters.service) {
      url.searchParams.set('service', parameters.service);
    }
    if (parameters.scope) {
      for (const scope of parameters.scope.split(/\s+/)) {
        url.searchParams.append('scope', scope);
      }
    }

    const resp = await fetch(url.toString(), { headers });

    if (!resp.ok) {
      throw new Error(`Could not get authorization token from ${ url } (for ${ url }): ${ JSON.stringify(resp) }`);
    }

    let result: any;

    try {
      result = await resp.json();
    } catch (ex) {
      const error = new Error(`Failed to parse authorization response`);

      (error as any).cause = ex;
      throw error;
    }

    const parsed = {
      token:      result.token || result.access_token,
      issued_at:  result.issued_at ?? (new Date()).toISOString(),
      expires_in: result.expires_in ?? 300,
    };

    type parsedKey = keyof typeof parsed;
    const types: Record<parsedKey, 'string' | 'number'> = {
      token:      'string',
      issued_at:  'string',
      expires_in: 'number',
    };
    let issuedDate: number;

    for (const [k, type] of Object.entries(types) as [parsedKey, typeof types[parsedKey]][]) {
      // eslint-disable-next-line valid-typeof -- The set is hard-coded.
      if (typeof parsed[k] !== type) {
        throw new TypeError(`Failed to read authorization response: ${ k } is not a ${ type } (${ typeof parsed[k] })`);
      }
    }

    try {
      issuedDate = Date.parse(parsed.issued_at);
    } catch (ex) {
      const error = new Error(`Failed to parse authorization response issued_at ${ parsed.issued_at }`);

      (error as any).cause = ex;
      throw error;
    }

    this.tokenCache[host] = {
      expiry: issuedDate + parsed.expires_in * 1_000,
      token:  parsed.token,
    };

    return { Authorization: `Bearer ${ parsed.token }` };
  }

  protected parseAuthHeader(header: string): { scheme: string, parameters: Record<string, string> }[] {
    // This header is a bit tricky (hence a separate method for testing):
    // The header may contain multiple comma-separated challenge specifications,
    // each of which consists of one word ("scheme") plus zero or more comma-
    // separated parameters for that scheme.  Parameters may have quoted values
    // which may internally contain commas.

    const results: { scheme: string, parameters: Record<string, string> }[] = [];
    let scheme = '';
    let parameters: Record<string, string> = {};

    function push() {
      if (scheme) {
        results.push({ scheme, parameters });
        parameters = {};
      }
    }

    header = header.trim();
    // From now on, `header` should never have leading/trailing whitespace.
    while (header) {
      const posMapping = {
        space: /\s/.exec(header)?.index ?? -1,
        equal: header.indexOf('='),
        comma: header.indexOf(','),
        end:   header.length,
      } as const;
      const posList = (Object.entries(posMapping) as [keyof typeof posMapping, number][])
        .filter(([, v]) => v >= 0)
        .sort(([, l], [, r]) => l - r);
      const [type, pos] = posList[0];

      switch (type) {
      case 'equal': {
        // An equals sign precedes any spaces etc.; this is a parameter.
        const key = header.substring(0, pos);
        let value = '';

        header = header.substring(pos + 1).trimStart();
        if (header.startsWith('"')) {
          let quoteEnded = false;

          header = header.substring(1);

          while (!quoteEnded) {
            const quotePosMapping = {
              backslash: header.indexOf('\\'),
              quote:     header.indexOf('"'),
              end:       header.length,
            } as const;
            const quotePosList = (Object.entries(quotePosMapping) as [keyof typeof quotePosMapping, number][])
              .filter(([, v]) => v >= 0)
              .sort(([, l], [, r]) => l - r);
            const [quoteType, quotePos] = quotePosList[0];

            switch (quoteType) {
            case 'backslash': {
              // We can get away with just treating the next character as
              // a literal (no `\n` for newline, etc.).
              value += header.substring(0, quotePos);
              header = header.substring(quotePos + 1);
              if (header) {
                value += header.substring(0, 1);
                header = header.substring(1);
              }
              break;
            }
            case 'quote': {
              value += header.substring(0, quotePos);
              header = header.substring(quotePos + 1).replace(/^[,\s]*/, '');
              quoteEnded = true;
              break;
            }
            case 'end': {
              // Could not find end of quote
              value += header;
              header = '';
              quoteEnded = true;
              break;
            }
            }
          }
        } else {
          // This value is not quoted
          const commaPos = header.indexOf(',');

          if (commaPos < 0) {
            // No comma, the parameter runs to the end of the header.
            value = header;
            header = '';
          } else {
            value = header.substring(0, commaPos);
            header = header.substring(commaPos).replace(/^[,\s]*/, '');
          }
        }

        if (scheme) {
          // Only allow adding parameters if we already found a scheme.
          parameters[key] = value;
        }
        break;
      }
      case 'space': {
        // A space precedes any equals signs; this is a scheme.
        push();
        scheme = header.substring(0, pos).toLowerCase();
        header = header.substring(pos).replace(/^[,\s]*/, '');
        break;
      }
      case 'end': {
        // Neither space nor equal found.
        // This is a bare scheme.
        push();
        scheme = header.trim().toLowerCase();
        header = header.substring(scheme.length).trim();
        break;
      }
      case 'comma': {
        // This is a bare scheme.
        push();
        scheme = header.substring(0, pos);
        header = header.substring(pos + 1).replace(/^[,\s]*/, '');
      }
      }
    }

    push();

    return results;
  }

  /**
   * Determine authentication required.
   * @param endpoint The endpoint to use to test for authentication requirements.
   * @returns The headers needed for authentication.
   */
  async authenticate(endpoint: URL): Promise<Headers> {
    if (endpoint.host in this.tokenCache) {
      // If we have a valid cached token, use it directly.
      const cachedToken = this.tokenCache[endpoint.host];

      if (cachedToken.expiry > Date.now()) {
        return new Headers({ Authorization: `Bearer ${ cachedToken.token }` });
      }
    }

    const resp = await fetch(endpoint.toString());

    if (resp.status !== 401) {
      console.debug(`${ endpoint } does not require authentication`);

      return new Headers();
    }

    const authenticateHeader = resp.headers.get('WWW-Authenticate') ?? '';

    for (const challenge of this.parseAuthHeader(authenticateHeader)) {
      if (challenge.scheme === 'basic') {
        try {
          return new Headers(await this.basicAuth(endpoint.toString()));
        } catch (ex) {
          console.debug(`Could not do Basic authentication for ${ endpoint }`, ex);
        }
      } else if (challenge.scheme === 'bearer') {
        try {
          return new Headers(await this.bearerAuth(endpoint.toString(), challenge.parameters));
        } catch (ex) {
          console.debug(`Could not do Bearer authentication for ${ endpoint }:`, ex);
        }
      } else {
        console.debug(`Don't know how to do ${ challenge.scheme } authentication for ${ endpoint }, skipping`);
      }
    }

    // If we reach here, we got a HTTP 401, but couldn't figure out how to do
    // authentication.
    throw new Error(`Failed to find compatible authentication scheme for ${ endpoint }`);
  }
}

const auth = new RegistryAuth();

export default auth;
