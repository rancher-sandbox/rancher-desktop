import http from 'http';
import https from 'https';
import os from 'os';

import Electron from 'electron';
import ElectronProxyAgent from 'electron-proxy-agent';
import MacCA from 'mac-ca';
import WinCA from 'win-ca';

export default function setupNetworking() {
  const session = Electron.session.defaultSession;

  const httpAgent = new ElectronProxyAgent(session);

  httpAgent.protocol = 'http:';
  http.globalAgent = httpAgent;

  const httpsAgent = new ElectronProxyAgent(session);

  httpsAgent.protocol = 'https:';
  https.globalAgent = httpsAgent;

  if (os.platform().startsWith('win')) {
    // Inject the Windows certs.
    WinCA({ inject: '+' });
  }
}

// Set up certificate handling for system certificates on Windows and macOS
Electron.app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
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
    }
  }

  console.log(`Not handling certificate error ${ error } for ${ url }`);

  // eslint-disable-next-line node/no-callback-literal
  callback(false);
});
