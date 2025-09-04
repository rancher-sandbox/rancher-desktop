/**
 * This module fetches system CAs on Linux.  The command lines are based on the
 * `linux-ca` package on NPM, but none of the code is copied.
 */

import checkCertValidity from './cert-parse';

import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.networking;

/**
 * Asynchronously enumerate the certificate authorities that should be used to
 * build the Rancher Desktop trust store, in PEM format in undefined order.
 */
export default async function * getLinuxCertificates(): AsyncIterable<string> {
  const tokenURLs = await Array.fromAsync(listTokens());
  const promises = tokenURLs.map(listCertificates).map(async function(certURLIterable) {
    return (await Array.fromAsync(certURLIterable)).map(getCertificate);
  });
  const certs = await Promise.all((await Promise.all(promises)).flat());

  yield * certs.filter(defined).filter(checkCertValidity);
}

async function * listTokens(): AsyncIterable<string> {
  try {
    const { stdout } = await spawnFile('p11tool', ['--list-token-urls'],
      { stdio: ['ignore', 'pipe', console] });

    for (const line of stdout.split(/\n/).filter(x => x)) {
      yield line.trim();
    }
  } catch (ex) {
    console.error(`Error listing system certificate tokens, ignoring: ${ ex }`);
  }
}

async function * listCertificates(tokenURL: string): AsyncIterable<string> {
  try {
    const { stdout } = await spawnFile(
      'p11tool', ['--list-all-trusted', '--only-urls', '--batch', tokenURL],
      { stdio: ['ignore', 'pipe', console] });

    for (const line of stdout.split(/\n/).filter(x => x)) {
      yield line.trim();
    }
  } catch (ex) {
    console.error(`Error listing system certificates, ignoring: ${ ex }`);
  }
}

async function getCertificate(certURL: string): Promise<string | undefined> {
  try {
    const { stdout } = await spawnFile(
      'p11tool', ['--export', certURL],
      { stdio: ['ignore', 'pipe', console] });

    return stdout.trim();
  } catch (ex) {
    console.error(`Error getting system certificate, ignoring: ${ ex }`);
  }
}
