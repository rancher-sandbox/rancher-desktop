import http from 'http';
import https from 'https';
import tls from 'tls';
import util from 'util';

import _fetch, { RequestInit } from 'node-fetch';

import { getSystemCertificates } from '@/main/networking';

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
      if (cert.issuerCertificate.fingerprint === cert.fingerprint) {
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
 * CustomAgent is a custom https.Agent that examines TLS connections and
 * manually does the certificate checking and rejection.  This is needed as
 * the default flow does not allow examination of the rejected certificate.
 */
class CustomAgent extends https.Agent {
  lastError?: Error;

  createConnection(options: http.ClientRequestArgs, ...args: any) {
    // create the socket, but tell it to _not_ reject unauthorized connections.
    // We manually raise errors instead; this is required to fetch the offending certificate.
    const method = (https.Agent.prototype as any).createConnection;
    const socket = method.call(this, { ...options, rejectUnauthorized: false }, ...args);

    this.lastError = undefined;
    if (socket instanceof tls.TLSSocket) {
      socket.on('secureConnect', () => {
        if (socket.authorized) {
          return;
        }
        const cert = socket.getPeerCertificate(true);
        let error = socket.authorizationError;

        if (typeof error === 'string') {
          error = new CertificateVerificationError(error, cert);
        }
        this.lastError = error;
        socket.emit('error', error);
      });
    }

    return socket;
  }
}

let systemCerts: string[];

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
  if (!systemCerts) {
    const certs = [];

    for await (const cert of getSystemCertificates()) {
      certs.push(cert);
    }
    systemCerts = certs;
  }

  let agent: http.Agent | undefined;

  try {
    return await _fetch(url, {
      ...options,
      agent: (parsedURL) => {
        // Find the correct agent, given user options and defaults.
        const isSecure = parsedURL.protocol.startsWith('https');

        if (options?.agent) {
          if (options.agent instanceof http.Agent) {
            agent = options.agent;
          } else {
            agent = options.agent(parsedURL);
          }
        } else {
          agent = isSecure ? https.globalAgent : http.globalAgent;
        }
        if (!isSecure) {
          return agent;
        }

        // Need to construct a custom agent.
        const secureAgent = agent as https.Agent ?? https.globalAgent;
        let ca = secureAgent.options.ca ?? [];

        if (!Array.isArray(ca)) {
          ca = [ca];
        }
        agent = new CustomAgent({
          ...secureAgent.options,
          ca: [...ca, ...systemCerts],
        });

        return agent;
      }
    });
  } catch (ex) {
    if (agent instanceof CustomAgent) {
      throw agent.lastError ?? ex;
    }
    throw ex;
  }
}
