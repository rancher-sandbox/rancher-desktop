import crypto from 'crypto';

/**
 * The eMudhra intermediates whose private keys are public, and the roots above
 * them, as SHA-256 hashes of their SubjectPublicKeyInfo.
 * getSystemCertificates() leaves these out even when the host trusts them.
 * Matching the key instead of the certificate also drops cross-signed copies.
 * See https://emudhra.we-have-a-problem.com/.
 */
const DISTRUSTED_SPKI_SHA256 = new Set([
  'ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105', // EM DV TLS CA - G3B
  '43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b', // EM OV TLS CA - G3B
  'e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41', // EM EV TLS CA - G3B
  '49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f', // EM DV TLS CA - G3C
  '63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8', // EM OV TLS CA - G3C
  '5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0', // EM EV TLS CA - G3C
  'ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6', // EM OV CS CA - G3B
  '92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30', // EM OV CS CA - G3C
  '8d417db2dd8bf5e3084d1e3f196d583849d81bdd4c00c70b9d39369e96b8c782', // emSign ECC Root CA - G3
  'bd153ed7b0434f6886b17bce8bbe84ed340c7132d702a8f4fa318f756ecbd6f3', // AAA Certificate Services
  'c619e4780ed8e0abeda24ad732567de4383a7ea941338f6d1a7d1b49ac792fe9', // emSign Root TLS CA - G3
  '0a6c2b2ca5b364207954171987ac9d2178561569d8205457e77ca90c32ede282', // emSign Root CS CA - G3
]);

/**
 * Report whether the key of a PEM certificate is on the distrusted list.
 */
export function isDistrusted(pem: string): boolean {
  let spki: Buffer;

  try {
    spki = new crypto.X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
  } catch {
    // We cannot hash a certificate that does not parse, so keep it.
    return false;
  }

  return DISTRUSTED_SPKI_SHA256.has(crypto.createHash('sha256').update(spki).digest('hex'));
}
