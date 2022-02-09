import http from 'http';
import https from 'https';
import tls from 'tls';

import _fetch, { RequestInit } from 'node-fetch';

import { getSystemCertificates } from '@/main/networking';

/**
 * CertificateVerificationError is a custom Error class that describes a TLS
 * certificate that failed verification.
 */
export class CertificateVerificationError extends Error {
  constructor(error: string, cert: tls.DetailedPeerCertificate) {
    super(error);
    this.certificate = cert;
  }

  certificate: tls.DetailedPeerCertificate;
}

/**
 * CustomAgent is a custom https.Agent that examines TLS connections and
 * manually does the certificate checking and rejection.  This is needed as
 * the default flow does not allow examination of the rejected certificate.
 */
class CustomAgent extends https.Agent {
  createConnection(options: http.ClientRequestArgs, ...args: any) {
    // create the socket, but tell it to _not_ reject unauthorized connections.
    // We manually raise errors instead; this is required to fetch the offending certificate.
    const method = (https.Agent.prototype as any).createConnection;
    const socket = method.call(this, { ...options, rejectUnauthorized: false }, ...args);

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
        socket.emit('error', error);
      });
    }

    return socket;
  }
}

let systemCerts: string[];

/**
 * A wrapper for node-fetch to log certificates on error.
 */
export default async function fetch(url: string, options?: RequestInit) {
  if (!systemCerts) {
    const certs = [];

    for await (const cert of getSystemCertificates()) {
      certs.push(cert);
    }
    systemCerts = certs;
  }

  return await _fetch(url, {
    ...options,
    agent: (parsedURL) => {
      // Find the correct agent, given user options and defaults.
      let agent: http.Agent;

      if (options?.agent) {
        if (options.agent instanceof http.Agent) {
          agent = options.agent;
        } else {
          agent = options.agent(parsedURL);
        }
      } else {
        agent = http.globalAgent;
      }
      if (!parsedURL.protocol.startsWith('https')) {
        return agent;
      }

      // Need to construct a custom agent.
      const secureAgent = agent as https.Agent ?? https.globalAgent;
      let ca = secureAgent.options.ca ?? [];

      if (!Array.isArray(ca)) {
        ca = [ca];
      }

      return new CustomAgent({
        ...secureAgent.options,
        ca: [...ca, ...systemCerts],
      });
    }
  });
}
