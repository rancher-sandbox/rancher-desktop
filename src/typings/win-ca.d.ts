declare module 'win-ca/der2' {
  import * as forge from 'node-forge';

  namespace der2 {
    export enum format {
      der = 0,
      pem = 1,
      txt = 2,
      asn1 = 3,
      x509 = 4,
      forge = x509,
    }
    const der: typeof format.der;
    const pem: typeof format.pem;
    const txt: typeof format.txt;
    const asn1: typeof format.asn1;
    const x509: typeof format.x509;
    const forge: typeof format.forge;
  }

  /** Types that Buffer.from() can take as an argument. */
  type bufferFromType = number[] | ArrayBuffer | SharedArrayBuffer | Buffer

  function der(it: Buffer | bufferFromType): Buffer;

  function pem(it: Buffer | bufferFromType): string

  function txt(it: Buffer): string

  interface Asn1 {
    serial: forge.asn1.Asn1;
    issuer: forge.asn1.Asn1;
    valid: forge.asn1.Asn1;
    subject: forge.asn1.Asn1;
  }

  function asn1(it: Buffer): Asn1;

  function x509(it: Buffer): forge.pki.Certificate;

  function der2(): typeof der;
  function der2(format: der2.format.der): typeof der;
  function der2(format: der2.format.der, blob: Buffer | bufferFromType): Buffer;
  function der2(format: der2.format.pem): typeof pem;
  function der2(format: der2.format.pem, blob: Buffer | bufferFromType): string;
  function der2(format: der2.format.txt): typeof txt;
  function der2(format: der2.format.txt, blob: Buffer): string;
  function der2(format: der2.format.asn1): typeof asn1;
  function der2(format: der2.format.asn1, blob: Buffer): Asn1;
  function der2(format: der2.format.x509): typeof x509;
  function der2(format: der2.format.x509, blob: Buffer): forge.pki.Certificate;

  export default der2;

}

declare module 'win-ca/lib/save' {

}

declare module 'win-ca' {
  import _der2 from 'win-ca/der2';

  interface apiOptions {
    disabled?: boolean;
    fallback?: boolean;
    store?: string[];
    async?: boolean;
    unique?: boolean;
    format?: _der2.format;
    ondata?: any[] | ((cert: any) => void);
    onend?: () => void;
    generator?: boolean;
    inject?: boolean | '+';
    save?: boolean | string | string[];
    onsave?: (path: string | undefined) => void;
  }
  namespace api {
    namespace der2 {
      const der = _der2.der;
      const pem = _der2.pem;
      const txt = _der2.txt;
      const asn1 = _der2.asn1;
      const x509 = _der2.x509;
      const forge = _der2.forge;
    }
  }
  function api(params?: apiOptions): void;
  export default api;
}
