import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import getMacCertificates, { getFilteredCertificates, getPEMCertificates, readFileByLine } from '../mac-ca';
import { spawnFile } from '@/utils/childProcess';

// TypeScript doesn't have references to the DOM declarations here; pulling them
// in directly causes lint errors elsewhere (due to @deprecated annotations).
// Declare a minimal set we need here.

interface Element {
  innerHTML: string;
  textContent?: string;
}
interface Document {
  body: Element;
  querySelectorAll(query: string): ArrayLike<Element>;
}
declare let document: Document;

const describeDarwin = os.platform() === 'darwin' ? describe : describe.skip;
const testDarwin = os.platform() === 'darwin' ? test : test.skip;

/**
 * Helper function to run a callback with a working directory that will be
 * cleaned up after execution.
 */
async function withWorkDir(cb: (workdir: string) => Promise<void>): Promise<void> {
  const workdir = await fs.promises.mkdtemp('rancher-desktop-mac-ca-test-');

  try {
    await cb(workdir);
  } finally {
    await fs.promises.rm(workdir, {
      recursive: true, force: true, maxRetries: 3
    });
  }
}

describeDarwin('getMacCertificates', () => {
  it('should return all certs from all keychains', async() => {
    const certs: Record<string, string[]> = {
      'first keychain':  ['A1', 'A2'],
      'second keychain': ['B1', 'B2'],
    };

    async function* listKeychains(): AsyncIterable<string> {
      yield * Object.keys(certs);
    }

    async function* getFilteredCertificates(workdir: string, keychain: string): AsyncIterable<string> {
      expect(certs).toHaveProperty(keychain);
      yield * certs[keychain] ?? [];
    }

    const results: string[] = [];

    for await (const cert of getMacCertificates({ listKeychains, getFilteredCertificates })) {
      results.push(cert);
    }

    expect(results).toEqual(Object.values(certs).flat());
  });
});

describeDarwin('getFilteredCertificates', () => {
  it('should return (some) system certs', async() => {
    const keychainPath = '/System/Library/Keychains/SystemRootCertificates.keychain';
    const trustStorePath = '/System/Library/Security/Certificates.bundle/Contents/Resources/TrustStore.html';
    const trustStoreHTML = await fs.promises.readFile(trustStorePath, 'utf-8');

    // Get the list of certificates we expect
    document.body.innerHTML = trustStoreHTML;
    const trustStoreQuery = 'body > h1:first-of-type + div td:last-child';
    const expectedFingerprints = new Set<string>();
    const actualFingerprints = new Set<string>();

    for (const child of Array.from(document.querySelectorAll(trustStoreQuery))) {
      const fingerprint = child.textContent?.replace(/\s+/g, '') ?? '';

      expectedFingerprints.add(fingerprint.replace(/..(?!$)/g, s => `${ s }:`));
    }
    expect(Array.from(expectedFingerprints)).not.toHaveLength(0);

    await withWorkDir(async(workdir) => {
      for await (const certPEM of getFilteredCertificates(workdir, keychainPath)) {
        actualFingerprints.add(new crypto.X509Certificate(certPEM).fingerprint256);
      }
    });

    // The expected list contains things that fail our additional checks; so
    // ensure that the actual list is a subset.
    expect(Array.from(actualFingerprints)).not.toHaveLength(0);
    expect(expectedFingerprints).toEqual(expect.objectContaining(actualFingerprints));
  }, 8_000);

  // C=CA/CN=Rancher Desktop Testing Non-CA
  const certPemNonCA = `-----BEGIN CERTIFICATE-----
    MIIBKDCB2wIUJIRiYbFl258VUvwMwPWA6GKPodIwBQYDK2VwMDYxCzAJBgNVBAYT
    AkNBMScwJQYDVQQDDB5SYW5jaGVyIERlc2t0b3AgVGVzdGluZyBOb24tQ0EwIBcN
    MjIwMzI5MjIwODQ1WhgPOTk5OTEyMzEyMjA4NDVaMDYxCzAJBgNVBAYTAkNBMScw
    JQYDVQQDDB5SYW5jaGVyIERlc2t0b3AgVGVzdGluZyBOb24tQ0EwKjAFBgMrZXAD
    IQBwEDDke62YDtEocVLHFZ9l2EYW7SaoBqpDvVJYeI1oIDAFBgMrZXADQQBItfWX
    Fw62fc1b2G9jQGCrPYtT2iFiATlIQB6TJvVVYcjrLlETJNLX+ZFsSD01NIIdeq9b
    FKxCZ6R0de6Cnt8P
    -----END CERTIFICATE-----`.replace(/\s*\n\s*/g, '\n');
  // C=CA/CN=Rancher Desktop Testing CA
  const certPemRoot = `-----BEGIN CERTIFICATE-----
    MIIBezCCAS2gAwIBAgIUUd2u+UsCs13r6YHVL4YdbwewXYYwBQYDK2VwMDIxCzAJ
    BgNVBAYTAkNBMSMwIQYDVQQDDBpSYW5jaGVyIERlc2t0b3AgVGVzdGluZyBDQTAg
    Fw0yMjAzMjkyMjEzMTZaGA85OTk5MTIzMTIyMTMxNlowMjELMAkGA1UEBhMCQ0Ex
    IzAhBgNVBAMMGlJhbmNoZXIgRGVza3RvcCBUZXN0aW5nIENBMCowBQYDK2VwAyEA
    cBAw5HutmA7RKHFSxxWfZdhGFu0mqAaqQ71SWHiNaCCjUzBRMB0GA1UdDgQWBBQT
    kKM2s9iUvVuzI+s50TLXCEcM8TAfBgNVHSMEGDAWgBQTkKM2s9iUvVuzI+s50TLX
    CEcM8TAPBgNVHRMBAf8EBTADAQH/MAUGAytlcANBAEppX4ZZifyyLFFEgOhdMlMj
    /ObGGovkA7U2RqTuj54vmbOqEJmo+0PkSRjCfDN2Hkcx8FvR+RhNAgPWfe/+Ywk=
    -----END CERTIFICATE-----`.replace(/\s*\n\s*/g, '\n');
  // C=CA/CN=Rancher Desktop Testing Non-Root
  const certPemNonRoot = `-----BEGIN CERTIFICATE-----
    MIIBgTCCATOgAwIBAgIUYvAGGuX2ohoerrMr/+6OEgcn0VIwBQYDK2VwMDIxCzAJ
    BgNVBAYTAkNBMSMwIQYDVQQDDBpSYW5jaGVyIERlc2t0b3AgVGVzdGluZyBDQTAg
    Fw0yMjAzMjkyMjIyMDBaGA85OTk5MTIzMTIyMjIwMFowODELMAkGA1UEBhMCQ0Ex
    KTAnBgNVBAMMIFJhbmNoZXIgRGVza3RvcCBUZXN0aW5nIE5vbi1Sb290MCowBQYD
    K2VwAyEAcBAw5HutmA7RKHFSxxWfZdhGFu0mqAaqQ71SWHiNaCCjUzBRMB0GA1Ud
    DgQWBBQTkKM2s9iUvVuzI+s50TLXCEcM8TAfBgNVHSMEGDAWgBQTkKM2s9iUvVuz
    I+s50TLXCEcM8TAPBgNVHRMBAf8EBTADAQH/MAUGAytlcANBAOJQphafL/xaX7XH
    RS+/AEt70UlNS+fI7pQD1/v68JRMyCnxrSUj0C94J340ldDJKD1vSjGWKo2ickld
    RfcuIQY=
    -----END CERTIFICATE-----`.replace(/\s*\n\s*/g, '\n');

  it('should reject non-CA certificates', async() => {
    async function *getPEMCertificates(): AsyncIterable<string> {
      yield certPemNonCA;
      yield certPemRoot;
    }

    function spawnFile() {
      return Promise.resolve({ stdout: '' });
    }
    const results: string[] = [];

    await withWorkDir(async(workdir) => {
      const iterator = getFilteredCertificates(workdir, '', { getPEMCertificates, spawnFile });

      for await (const cert of iterator) {
        results.push(cert);
      }
    });
    expect(results).toEqual([certPemRoot]);
  });
  it('should reject non-root certificates', async() => {
    async function *getPEMCertificates(): AsyncIterable<string> {
      yield certPemNonRoot;
      yield certPemRoot;
    }

    function spawnFile() {
      return Promise.resolve({ stdout: '' });
    }
    const results: string[] = [];

    await withWorkDir(async(workdir) => {
      const iterator = getFilteredCertificates(workdir, '', { getPEMCertificates, spawnFile });

      for await (const cert of iterator) {
        results.push(cert);
      }
    });
    expect(results).toEqual([certPemRoot]);
  });
  it('should reject untrusted certificates', async() => {
    async function *getPEMCertificates(): AsyncIterable<string> {
      yield certPemRoot;
    }

    function spawnFile() {
      return Promise.reject('Some reason');
    }
    const results: string[] = [];

    await withWorkDir(async(workdir) => {
      const iterator = getFilteredCertificates(workdir, '', { getPEMCertificates, spawnFile });

      for await (const cert of iterator) {
        results.push(cert);
      }
    });
    expect(results).toEqual([]);
  });
});

describeDarwin('readFileByLine', () => {
  async function withBody(body: string): Promise<string[]> {
    const result: string[] = [];

    await withWorkDir(async(workdir) => {
      const workPath = path.join(workdir, 'test-input.txt');

      await fs.promises.writeFile(workPath, body, { encoding: 'utf-8' });
      for await (const line of readFileByLine(workPath)) {
        result.push(line);
      }
    });

    return result;
  }
  it('should handle empty file', async() => {
    expect(await withBody('')).toHaveLength(0);
  }, 1_000);
  it('should find lines', async() => {
    const result = (await withBody('one\ntwo\nthree\nfour')).map(x => JSON.stringify(x));

    expect(result).toEqual(['"one"', '"two"', '"three"', '"four"']);
  }, 1_000);
  it('should strip new line at end of file', async() => {
    const result = (await withBody('one\ntwo\nthree\nfour\n')).map(x => JSON.stringify(x));

    expect(result).toEqual(['"one"', '"two"', '"three"', '"four"']);
  });
  it('should handle long lines', async() => {
    const filler = (new Array(256)).join('_');
    const input = ['one', 'two', 'three', 'four'].map(x => x + filler + x);
    const expected = input.map(x => JSON.stringify(x));
    const actual = (await withBody(input.join('\n'))).map(x => JSON.stringify(x));

    expect(actual).toEqual(expected);
  });
});

testDarwin('getPEMCertificates', async() => {
  // Just check that we have the same number of certificates as we would get
  // from /usr/bin/security directly.
  const certs: string[] = [];

  await withWorkDir(async(workdir) => {
    for await (const cert of getPEMCertificates(workdir)) {
      certs.push(cert);
    }
  });
  const { stdout } = await spawnFile('/usr/bin/security', ['find-certificate', '-a'], { stdio: 'pipe' });
  const lines = stdout.split(/\n/);
  const keychains = lines.filter(line => line.startsWith('keychain: '));

  expect(certs).toHaveLength(keychains.length);
});
