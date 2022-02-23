import http from 'http';
import https from 'https';
import os from 'os';

import Electron from 'electron';
import MacCA from 'mac-ca';
import WinCA from 'win-ca';
import LinuxCA from 'linux-ca';

import ElectronProxyAgent from './proxy';
import filterCert from './cert-parse';
import Logging from '@/utils/logging';
import mainEvents from '@/main/mainEvents';

const console = Logging.background;

export default function setupNetworking() {
  const session = Electron.session.defaultSession;

  const httpAgent = new ElectronProxyAgent(https.globalAgent.options, session);

  httpAgent.protocol = 'http:';
  http.globalAgent = httpAgent;

  const httpsAgent = new ElectronProxyAgent(https.globalAgent.options, session);

  httpsAgent.protocol = 'https:';
  https.globalAgent = httpsAgent;

  if (os.platform().startsWith('win')) {
    // Inject the Windows certs.
    WinCA({ store: ['root', 'ca'], inject: '+' });
  }

  // Set up certificate handling for system certificates on Windows and macOS
  Electron.app.on('certificate-error', async(event, webContents, url, error, certificate, callback) => {
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
            // eslint-disable-next-line node/no-callback-literal
            callback(true);

            return;
          }
        }
      } catch (ex) {
        console.error(ex);
      }
    }

    console.log(`Not handling certificate error ${ error } for ${ url }`);

    // eslint-disable-next-line node/no-callback-literal
    callback(false);
  });

  mainEvents.on('cert-get-ca-certificates', async() => {
    const certs: string[] = [];

    for await (const cert of getSystemCertificates()) {
      certs.push(cert);
    }

    mainEvents.emit('cert-ca-certificates', certs);
  });
}

/**
 * Get the system certificates in PEM format.
 */
export async function *getSystemCertificates(): AsyncIterable<string> {
  const platform = os.platform();

  if (platform.startsWith('win')) {
    // On Windows, be careful of the new lines.
    for await (let cert of WinCA({
      format: WinCA.der2.pem, generator: true, store: ['root', 'ca']
    })) {
      cert = cert.replace(/\r/g, '');
      if (filterCert(cert)) {
        yield cert;
      }
    }
  } else if (platform === 'darwin') {
    yield * MacCA.all(MacCA.der2.pem).filter(filterCert);
  } else if (platform === 'linux') {
    yield * (await LinuxCA.getAllCerts(true)).flat().filter(filterCert);
  } else {
    throw new Error(`Cannot get system certificates on ${ platform }`);
  }
}
