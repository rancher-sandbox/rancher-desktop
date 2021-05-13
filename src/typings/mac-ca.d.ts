declare module 'mac-ca/lib/fomatter' {
  // eslint-disable-next-line import/no-duplicates
  import * as forge from 'node-forge';

  export enum validFormats {
    der = 0,
    pem = 1,
    txt = 2,
    asn1 = 3,
  }

  export interface Asn1 {
    serial: forge.asn1.Asn1;
    issuer: forge.asn1.Asn1;
    valid: forge.asn1.Asn1;
    subject: forge.asn1.Asn1;
  }

  /* eslint-disable no-redeclare */
  export function transform(format: validFormats.der): forge.util.ByteStringBuffer;
  export function transform(format: validFormats.pem): string;
  export function transform(format: validFormats.txt): string;
  export function transform(format: validFormats.asn1): Asn1;
  export function transform(format: undefined): forge.pki.Certificate;
  /* eslint-enable no-redeclare */
}

declare module 'mac-ca' {
  // eslint-disable-next-line import/no-duplicates
  import * as forge from 'node-forge';
  import { transform, validFormats, Asn1 } from 'mac-ca/lib/fomatter';

  export { validFormats as der2 };

  type transformResult = ReturnType<typeof transform>;

  /* eslint-disable no-redeclare */
  export function all(format: validFormats.der): forge.util.ByteStringBuffer[];
  export function all(format: validFormats.pem): string[];
  export function all(format: validFormats.txt): string[];
  export function all(format: validFormats.asn1): Asn1[];
  export function all(format?: undefined): forge.pki.Certificate[];
  /* eslint-enable no-redeclare */

  type eachCallback = (item: transformResult) => void;

  /* eslint-disable no-redeclare */
  export function each(callback: (certificate: forge.pki.Certificate) => void): void;
  export function each(format: validFormats.der, callback: (der: forge.util.ByteStringBuffer) => void): void;
  export function each(format: validFormats.pem, callback: (pem: string) => void): void;
  export function each(format: validFormats.txt, callback: (text: string) => void): void;
  export function each(format: validFormats.asn1, callback: (asn1: Asn1) => void): void;
  export function each(format: undefined, callback: (certificate: forge.pki.Certificate) => void): void;
  export function each(callback: (certificate: forge.pki.Certificate) => void): void;
  /* eslint-enable no-redeclare */
}
