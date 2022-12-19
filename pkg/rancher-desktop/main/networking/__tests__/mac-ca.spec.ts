import crypto from 'crypto';
import fs from 'fs';
import os from 'os';

// mock crypto to fake certificates.
jest.mock('crypto');

// mock child process execution to return our own results.
jest.mock('@pkg/utils/childProcess');

// eslint-disable-next-line import/first -- need to be after jest.mock() call.
import getMacCertificates from '../mac-ca';

// eslint-disable-next-line import/first -- need to be after jest.mock() call.
import { spawnFile } from '@pkg/utils/childProcess';

/**
 * testCertMock is a subset of crypto.X509Certificate with an additional bit to
 * indicate whether we expect this certificate to be accepted.
 */
interface testCertMock {
  ca: boolean;
  issuer: string;
  subject: string;
  acceptable: boolean;
}

const testDarwin = os.platform() === 'darwin' ? test : test.skip;
const spawnFileMock = spawnFile as jest.MockedFunction<typeof spawnFile>;
const X509CertificateMock = crypto.X509Certificate as jest.MockedClass<typeof crypto.X509Certificate>;

testDarwin('getMacCertificates', async() => {
  const endCertMarker = '\n-----END CERTIFICATE-----';
  // test certificates; keyed by keychain, then cert PEM
  const testCerts: Record<string, Record<string, testCertMock>> = {
    '/System/Library/Keychains/SystemRootCertificates.keychain': {
      [`system ca root good issuer${ endCertMarker }`]: {
        ca:         true,
        issuer:     'some issuer',
        subject:    'some issuer',
        acceptable: true,
      },
      [`system root not ca${ endCertMarker }`]: {
        ca:         false,
        issuer:     'some issuer',
        subject:    'some issuer',
        acceptable: false,
      },
    },
    '/Library/Keychains/System.keychain': {
      [`system keychain${ endCertMarker }`]: {
        ca:         true,
        issuer:     'some issuer',
        subject:    'some some issuer',
        acceptable: true,
      },
      [`system keychain different issuer${ endCertMarker }`]: {
        ca:         true,
        issuer:     'some issuer',
        subject:    'some subject',
        acceptable: true,
      },
    },
  };
  const expected: string[] = [];
  const actual: string[] = [];
  const pemToKeychain: Record<string, string> = {};

  for (const [keychain, store] of Object.entries(testCerts)) {
    for (const [pem, cert] of Object.entries(store)) {
      pemToKeychain[pem] = keychain;
      if (cert.acceptable) {
        expected.push(pem);
      }
    }
  }

  async function mockSpawnFile(command: string, args: string[], opts: {stdio?:any[]}): Promise<{stdout: string}> {
    let stdout = '';
    const handlers: Record<string, () => Promise<void>> = {
      'list-keychains': () => {
        expect(args).toHaveLength(1);
        stdout = Object
          .keys(testCerts)
          .filter(x => !x.endsWith('SystemRootCertificates.keychain'))
          .map(p => `    "${ p }"    `).join('\n');

        return Promise.resolve();
      },
      'find-certificate': () => {
        expect(args).toContain('-a'); // find all certs, not just the first
        expect(args).toContain('-p'); // print certs as PEM
        if (args.length > 3) {
          const keychain = args[3];

          expect(args).toHaveLength(4);
          expect(Object.keys(testCerts)).toContain(keychain);
          stdout = Object.keys(testCerts[keychain]).join('\n');
        } else {
          expect(args).toHaveLength(3);
          for (const keychain in testCerts) {
            if (keychain.endsWith('SystemRootCertificates.keychain')) {
            // emulate /usr/bin/security: don't list system roots implicitly.
              continue;
            }
            stdout += `${ Object.keys(testCerts[keychain]).join('\n') }\n`;
          }
        }

        return Promise.resolve();
      },
      'verify-cert': async() => {
        const pathFlag = args.find(arg => arg.startsWith('-c')) ?? '';
        const certPath = pathFlag.substring(2);

        expect(certPath).not.toHaveLength(0);
        expect(args).toContain('-L'); // local verification only; no network.
        expect(args).toContain('-l'); // certificate should be a CA
        expect(args).toContain('-Roffline'); // revocation checking: offline only

        const actualPEM = await fs.promises.readFile(certPath, 'utf-8');
        const keychain = pemToKeychain[actualPEM];

        expect(pemToKeychain).toHaveProperty(actualPEM);
        expect(testCerts[keychain]).toHaveProperty(actualPEM);
        if (!testCerts[keychain][actualPEM].acceptable) {
          throw new Error('vertificate is not trusted, this should be caught');
        }
      },
    };

    expect(command).toEqual('/usr/bin/security');
    expect(args).not.toHaveLength(0);
    expect(handlers).toHaveProperty(args[0]);
    await handlers[args[0]]();

    const outStream = opts?.stdio?.[1];

    if (outStream instanceof fs.WriteStream) {
      outStream.write(stdout);
    }

    return { stdout };
  }

  spawnFileMock.mockImplementation(mockSpawnFile as any);
  X509CertificateMock.mockImplementation((buffer) => {
    const pem = buffer as string;
    const keychain = pemToKeychain[pem];

    expect(pemToKeychain).toHaveProperty(pem);
    expect(testCerts[keychain]).toHaveProperty(pem);

    return testCerts[keychain][pem] as unknown as crypto.X509Certificate;
  });
  for await (const certPEM of getMacCertificates()) {
    actual.push(certPEM);
  }

  expect(actual.sort()).toEqual(expected.sort());
});
