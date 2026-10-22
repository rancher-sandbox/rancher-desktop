import fs from 'fs';
import { join, resolve } from 'path';

import { isDistrusted } from '../distrusted-cas';

const assetsDir = resolve('./pkg/rancher-desktop/main/networking/__tests__/assets');

function readAsset(name: string) {
  return fs.readFileSync(join(assetsDir, name), 'utf-8');
}

describe('isDistrusted', () => {
  test.each([
    'emsign-ecc-root-ca-g3.pem',
    'em-dv-tls-ca-g3b.pem',
    'em-dv-tls-ca-g3b-aaa.pem',
  ])('drops %s', (name) => {
    expect(isDistrusted(readAsset(name))).toBe(true);
  });

  test('keeps an unrelated root', () => {
    expect(isDistrusted(readAsset('isrg-root-x1.pem'))).toBe(false);
  });

  test('keeps a certificate that does not parse', () => {
    expect(isDistrusted('-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n')).toBe(false);
  });
});
