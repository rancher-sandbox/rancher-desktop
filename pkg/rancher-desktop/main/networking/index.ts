import dns from 'dns';
import http from 'http';
import https from 'https';
import os from 'os';
import util from 'util';

import Electron from 'electron';
import LinuxCA from 'linux-ca';

import filterCert from './cert-parse';
import getMacCertificates from './mac-ca';
import ElectronProxyAgent from './proxy';
import getWinCertificates from './win-ca';

import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import { windowMapping } from '@pkg/window';

const console = Logging.networking;

export default async function setupNetworking() {
  const session = Electron.session.defaultSession;
  const httpsOptions: https.AgentOptions = { ...https.globalAgent.options };

  if (!Array.isArray(httpsOptions.ca)) {
    httpsOptions.ca = httpsOptions.ca ? [httpsOptions.ca] : [];
  }
  for await (const cert of getSystemCertificates()) {
    httpsOptions.ca.push(cert);
  }

  const httpAgent = new ElectronProxyAgent(httpsOptions, session);

  httpAgent.protocol = 'http:';
  http.globalAgent = httpAgent;

  const httpsAgent = new ElectronProxyAgent(httpsOptions, session);

  httpsAgent.protocol = 'https:';
  https.globalAgent = httpsAgent;

  // Set up certificate handling for system certificates on Windows and macOS
  Electron.app.on('certificate-error', async(event, webContents, url, error, certificate, callback) => {
    const tlsPort = 9443;
    const dashboardUrls = [
      `https://127.0.0.1:${ tlsPort }`,
      `wss://127.0.0.1:${ tlsPort }`,
      'http://127.0.0.1:6120',
      'ws://127.0.0.1:6120',
    ];

    const pluginDevUrls = [
      `https://localhost:8888`,
      `wss://localhost:8888`,
    ];

    if (
      process.env.NODE_ENV === 'development' &&
      process.env.RD_ENV_PLUGINS_DEV &&
      pluginDevUrls.some(x => url.startsWith(x))
    ) {
      event.preventDefault();
      // eslint-disable-next-line n/no-callback-literal
      callback(true);

      return;
    }

    if (dashboardUrls.some(x => url.startsWith(x)) && 'dashboard' in windowMapping) {
      event.preventDefault();
      // eslint-disable-next-line n/no-callback-literal
      callback(true);

      return;
    }

    if (error === 'net::ERR_CERT_INVALID') {
      // If we're getting *this* particular error, it means it's an untrusted cert.
      // Ask the system store.
      console.log(`Attempting to check system certificates for ${ url } (${ certificate.subjectName }/${ certificate.fingerprint })`);
      try {
        for await (const cert of getSystemCertificates()) {
          // For now, just check that the PEM data matches exactly; this is
          // probably a little more strict than necessary, but avoids issues like
          // an attacker generating a cert with the same serial.
          if (cert === certificate.data.replace(/\r/g, '')) {
            console.log(`Accepting system certificate for ${ certificate.subjectName } (${ certificate.fingerprint })`);
            // eslint-disable-next-line n/no-callback-literal
            callback(true);

            return;
          }
        }
      } catch (ex) {
        console.error(ex);
      }
    }

    console.log(`Not handling certificate error ${ error } for ${ url }`);

    // eslint-disable-next-line n/no-callback-literal
    callback(false);
  });

  mainEvents.on('cert-get-ca-certificates', async() => {
    const certs: string[] = [];

    for await (const cert of getSystemCertificates()) {
      certs.push(cert);
    }

    mainEvents.emit('cert-ca-certificates', certs);
  });

  mainEvents.emit('network-ready');
}

/**
 * Get the system certificates in PEM format.
 */
export async function *getSystemCertificates(): AsyncIterable<string> {
  const platform = os.platform();

  if (platform.startsWith('win')) {
    for await (const cert of getWinCertificates({ store: ['CA', 'ROOT'] })) {
      if (cert.notAfter.valueOf() > Date.now()) {
        yield cert.pem;
      }
    }
  } else if (platform === 'darwin') {
    yield * getMacCertificates();
  } else if (platform === 'linux') {
    yield * (await LinuxCA.getAllCerts(true)).flat().filter(filterCert);
  } else {
    throw new Error(`Cannot get system certificates on ${ platform }`);
  }
}

export async function checkConnectivity(target: string): Promise<boolean> {
  try {
    await util.promisify(dns.lookup)(target);

    return true;
  } catch {
    return false;
  }
}
