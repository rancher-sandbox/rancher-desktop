/**
 * This module fetchs system certificates on macOS.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import util from 'util';

import _ from 'lodash';

import Logging from '@/utils/logging';
import { spawnFile } from '@/utils/childProcess';

const console = Logging.networking;

/**
 * The depInjection interface is used for testing.
 */
interface depInjection {
  getPEMCertificates?: (workdir: string, keychain?: string) => AsyncIterable<string>;
  spawnFile?: (_1: string, _2: string[], _3?: unknown) => Promise<{stdout: string}>;
  listKeychains?: () => AsyncIterable<string>;
  getFilteredCertificates?: (workdir: string, keychain: string) => AsyncIterable<string>;
}

/**
 * Asynchronously enumerate the certificate authorities that should be used to
 * build the Rancher Desktop trust store, in PEM format in undefined order.
 */
export default async function* getMacCertificates(deps_: depInjection = {}): AsyncIterable<string> {
  const deps = _.defaults(deps_, { listKeychains, getFilteredCertificates }) as Required<depInjection> ;
  const workdir = await fs.promises.mkdtemp('rancher-desktop-certificates-');

  try {
    for await (const keychain of deps.listKeychains()) {
      yield * deps.getFilteredCertificates(workdir, keychain);
    }
  } finally {
    await fs.promises.rm(workdir, {
      recursive: true, force: true, maxRetries: 3
    });
  }
}

/**
 * Return all keychains that we should import from.
 */
export async function* listKeychains(): AsyncIterable<string> {
  const { stdout } = await spawnFile('/usr/bin/security', ['list-keychains'],
    { stdio: ['ignore', 'pipe', console] });

  for (const line of stdout.split(/\n/)) {
    yield line.trim().replace(/^"|"$/g, '');
  }
  try {
    // Add the system root certificates keychain; this is normally not listed
    // as it wouldn't include _client_ certificates.
    const rootCerts = '/System/Library/Keychains/SystemRootCertificates.keychain';

    await fs.promises.access(rootCerts, fs.constants.R_OK);
    yield rootCerts;
  } catch (ex) { /* swallow the error */ }
}

/**
  * Asynchronously enumerate PEM-encoded certificates from the given keychain in
  * undefined order.
  *
  * @param workdir A temporary directory where files can be written.
  * @param keychain The full path to the keychain database to enumerate.
  * @note This is only exported for testing.
  */
export async function* getFilteredCertificates(workdir: string, keychain: string, deps_: depInjection = {}): AsyncIterable<string> {
  console.debug(`getting certificates from ${ keychain }...`);

  const deps = _.defaults(deps_, { getPEMCertificates, spawnFile }) as Required<depInjection>;
  const certIterator = deps.getPEMCertificates(workdir, keychain);

  for await (const certPEM of certIterator) {
    const cert = new crypto.X509Certificate(certPEM);
    const certPath = path.join(workdir, 'cert.pem');

    console.error('got cert', cert, cert.ca, cert.issuer, cert.subject, certPEM);
    if (!cert.ca) {
      console.debug('Skipping non-CA certificate', cert.subject);
      continue;
    }
    if (cert.issuer !== cert.subject) {
      console.debug('Skipping non-self-signed certificate', cert.subject);
      continue;
    }
    await fs.promises.writeFile(certPath, certPEM, 'utf-8');
    try {
      await deps.spawnFile('/usr/bin/security', ['verify-cert', '-c', certPath, '-L', '-l', '-R', 'offline'], { stdio: console });
    } catch (ex) {
      console.debug('Skipping untrusted certificate', cert.subject);
      continue;
    }
    yield certPEM;
  }
}

/**
 * Enumerate all system certificates as PEM, in undefined order.  This does not
 * do the necessary processing to ensure they are valid for our use.
 *
 * @param workdir A temporary directory where files can be written.
 * @note This is only exported for testing.
 */
export async function* getPEMCertificates(workdir: string, keychain?: string): AsyncIterable<string> {
  // In order to avoid issues on machine with a very large number of certificates,
  // write all certificates (in PEM format) to a file, and then read that file out.
  const pemFilePath = path.join(workdir, 'all-certs.pem');
  const pemFile = await fs.promises.open(pemFilePath, fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY);
  const pemFileStream = fs.createWriteStream(pemFilePath, { fd: pemFile });
  const args = ['find-certificate', '-a', '-p'];

  if (keychain) {
    args.push(keychain);
  }
  await spawnFile('/usr/bin/security', args, { stdio: ['ignore', pemFileStream, console] });
  await util.promisify((cb: (err?: Error | null | undefined) => void) => pemFileStream.close(cb))();
  await pemFile.close();

  let pemLines: string[] = [];

  for await (const line of readFileByLine(pemFilePath)) {
    pemLines.push(line);
    if (line === '-----END CERTIFICATE-----') {
      yield pemLines.join('\n');
      pemLines = [];
    }
  }
}

/**
 * Read the given file, returning one line at a time.
 *
 * @note This is only exported for testing.
 */
export async function* readFileByLine(filePath: string, encoding: BufferEncoding = 'utf-8'): AsyncIterable<string> {
  const file = await fs.promises.open(filePath, fs.constants.O_RDONLY);

  try {
    const buf = Buffer.alloc(256);
    let lastLine = '';

    while (true) {
      const { bytesRead } = await file.read(buf, 0, buf.length);

      if (bytesRead === 0) {
        break;
      }
      let offset = 0;

      while (true) {
        const nextNewLine = buf.indexOf('\n', offset, encoding);

        if (nextNewLine < 0) {
          lastLine += buf.toString(encoding, offset, bytesRead);
          break;
        }
        yield lastLine + buf.toString(encoding, offset, nextNewLine);
        lastLine = '';
        offset = nextNewLine + 1;
      }
    }
    if (lastLine) {
      yield lastLine;
    }
  } finally {
    await file.close();
  }
}
