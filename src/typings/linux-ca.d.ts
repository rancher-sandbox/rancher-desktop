declare module 'linux-ca' {
  // eslint-disable-next-line import/no-duplicates
  import * as forge from 'node-forge';

  export function getAllCerts(readSync?: boolean): Promise<string[]>;
  export function getFilteredCerts(filterAttribute: string, filterMethod?: (cert: forge.pki.Certificate, attribute) => boolean): Promise<string[]>;
  export function pemToCert(pem: string): forge.pki.Certificate;
  export function certToPem(cert: forge.pki.Certificate): string;
  export function defaultFilter(cert: forge.pki.Certificate, subject: string): boolean;
}
