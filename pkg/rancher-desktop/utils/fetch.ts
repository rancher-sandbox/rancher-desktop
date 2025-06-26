import http from 'http';
import https from 'https';
import stream from 'stream';
import tls from 'tls';
import util from 'util';

import _fetch from 'node-fetch';

export { Headers } from 'node-fetch';

import type { RequestInit } from 'node-fetch';
export type { RequestInit } from 'node-fetch';

/**
 * CertificateVerificationError is a custom Error class that describes a TLS
 * certificate that failed verification.
 */
export class CertificateVerificationError extends Error {
  constructor(error: string, cert: tls.DetailedPeerCertificate) {
    const wantedKeys = [
      'subject', 'issuer', 'subjectaltname', 'valid_from', 'valid_to',
      'fingerprint', 'fingerprint256', 'serialNumber'];

    super(error);
    this.error = error;
    this.certChain = [];
    while (cert) {
      this.certChain.push(Object.fromEntries(Object.entries(cert).filter(([x]) => wantedKeys.includes(x))));
      if (cert.issuerCertificate?.fingerprint === cert.fingerprint) {
        break;
      }
      cert = cert.issuerCertificate;
    }
  }

  [util.inspect.custom](depth: number, opts: util.InspectOptionsStylized) {
    return `${ opts.stylize(this.toString(), 'special') }\n${
      util.inspect({ ...this }, { ...opts, depth: Number.POSITIVE_INFINITY }) }`;
  }

  toString() {
    return `Certificate validation error: ${ this.error }`;
  }

  error: string;
  certChain: Partial<tls.PeerCertificate>[];
}

/**
 * wrapCreateConnection overrides the createConnection method of a given
 * https.Agent to capture the failing certificate on a certificate verification
 * failure.  In such a case a CertificateVerificationError would be thrown
 * instead of a normal error.
 *
 * @param agent The agent to wrap; it must call agent.createConnection() internally.
 */
function wrapCreateConnection(agent: https.Agent) {
  // This is the underlying createConnection method we will use
  const method: (options: http.ClientRequestArgs, ...args: any) => stream.Duplex =
     (agent as any).createConnection ?? (https.Agent.prototype as any).createConnection;
  // This lets out modify the emitted error after returning.
  const result: { lastError: Error | undefined, agent: https.Agent } = {
    lastError: undefined,
    agent:     Object.create(agent, {
      createConnection: {
        value(options: http.ClientRequestArgs, ...args: any) {
          // create the socket, but tell it to _not_ reject unauthorized connections.
          // We manually raise errors instead; this is required to fetch the offending certificate.
          const socket = method.call(this, { ...options, rejectUnauthorized: false }, ...args);

          result.lastError = undefined;
          if (socket instanceof tls.TLSSocket) {
            socket.on('secureConnect', () => {
              if (socket.authorized) {
                return;
              }
              const cert = socket.getPeerCertificate(true);
              let error = socket.authorizationError;

              if ((typeof error === 'string') && cert) {
                error = new CertificateVerificationError(error, cert);
              }
              result.lastError = error;
              socket.emit('error', error);
            });
          }

          return socket;
        },
      },
    }),
  };

  return result;
}

/**
 * Fetch a remote URL, throwing a CertificateVerificationError if there is an
 * issue with the server certificate.
 *
 * This is a wrapper for node-fetch's version of fetch(), except that on
 * certificate error we throw a CertificateVerificationError that provides
 * details on the certificate that failed to verify (instead of the default
 * behaviour where we only get the error string without certificate details).
 *
 * Note that, due to an implementation detail, providing a custom HTTP agent may
 * not work correctly.
 */
export default async function fetch(url: string, options?: RequestInit) {
  let result: { lastError: Error | undefined, agent: https.Agent } | undefined;

  try {
    return await _fetch(url, {
      ...options,
      agent: (parsedURL) => {
        // Find the correct agent, given user options and defaults.
        const isSecure = parsedURL.protocol.startsWith('https');
        let agent: boolean | http.Agent | undefined;

        if (options?.agent) {
          if (typeof options.agent === 'function') {
            agent = options.agent(parsedURL);
          } else {
            agent = options.agent;
          }
        } else {
          agent = isSecure ? https.globalAgent : http.globalAgent;
        }
        if (!isSecure) {
          return agent;
        }

        const secureAgent = agent as https.Agent ?? https.globalAgent;

        result = wrapCreateConnection(secureAgent);

        return result.agent;
      },
    });
  } catch (ex) {
    // result.lastError may be set by createConnection from wrapCreateConnection.
    if (result?.lastError) {
      throw result.lastError;
    }
    throw ex;
  }
}
