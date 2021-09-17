import http from 'http';
import https from 'https';
import os from 'os';

import Electron from 'electron';
import MacCA from 'mac-ca';
import WinCA from 'win-ca';
import LinuxCA from 'linux-ca';

import mainEvents from '@/main/mainEvents';
import ElectronProxyAgent from './proxy';

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
    WinCA({ inject: '+' });
  }
}

// Set up certificate handling for system certificates on Windows and macOS
Electron.app.on('certificate-error', async(event, webContents, url, error, certificate, callback) => {
  if (error === 'net::ERR_CERT_INVALID') {
    // If we're getting *this* particular error, it means it's an untrusted cert.
    // Ask the system store.
    console.log(`Attempting to check system certificates for ${ url } (${ certificate.subjectName }/${ certificate.fingerprint })`);
    if (os.platform().startsWith('win')) {
      const certs: string[] = [];

      WinCA({
        format: WinCA.der2.pem, ondata: certs, fallback: false
      });
      for (const cert of certs) {
        // For now, just check that the PEM data matches exactly; this is
        // probably a little more strict than necessary, but avoids issues like
        // an attacker generating a cert with the same serial.
        if (cert === certificate.data) {
          console.log(`Accepting system certificate for ${ certificate.subjectName } (${ certificate.fingerprint })`);
          // eslint-disable-next-line node/no-callback-literal
          callback(true);

          return;
        }
      }
    } else if (os.platform() === 'darwin') {
      for (const cert of MacCA.all(MacCA.der2.pem)) {
        // For now, just check that the PEM data matches exactly; this is
        // probably a little more strict than necessary, but avoids issues like
        // an attacker generating a cert with the same serial.
        if (cert === certificate.data) {
          console.log(`Accepting system certificate for ${ certificate.subjectName } (${ certificate.fingerprint })`);
          // eslint-disable-next-line node/no-callback-literal
          callback(true);

          return;
        }
      }
    } else if (os.platform() === 'linux') {
      // Not sure if this is a feature or bug, linux-ca returns certs
      // in a nested array
      for (const certs of await LinuxCA.getAllCerts(true)) {
        for (const cert of certs) {
          // For now, just check that the PEM data matches exactly
          if (certificate.data === cert) {
            console.log(`Accepting system certificate for ${ certificate.subjectName } (${ certificate.fingerprint })`);
            // eslint-disable-next-line node/no-callback-literal
            callback(true);

            return;
          }
        }
      }
    }
  }

  console.log(`Not handling certificate error ${ error } for ${ url }`);

  // eslint-disable-next-line node/no-callback-literal
  callback(false);
});

function defined<T>(input: T | undefined | null): input is T {
  return typeof input !== 'undefined' && input !== null;
}

mainEvents.on('cert-get-ca-certificates', async() => {
  let certs = https.globalAgent.options.ca;

  if (!Array.isArray(certs)) {
    certs = [certs].filter(defined);
  }

  if (os.platform() === 'win32') {
    // On Windows, win-ca doesn't add CAs into the agent; rather, it patches
    // `tls.createSecureContext()` instead, so we don't have a list of CAs here.
    // We need to fetch it manually.
    certs.push(...WinCA({ generator: true, format: WinCA.der2.pem }));
  } else if (os.platform() === 'linux') {
    // On Linux, linux-ca doesn't add CAs into the agent; so we add them manually.
    // Not sure if this is a bug or a feature, but linux-cA returns a nested
    // array with certs
    for (const crts of await LinuxCA.getAllCerts(true)) {
      certs.push(...crts);
    }
  }

  mainEvents.emit('cert-ca-certificates', certs);
});
