const crypto = require('crypto');

export const patchCrypto = () => {
  /**
   * md4 algorithm is not available anymore in NodeJS 17+ (because of lib SSL 3).
   * In that case, silently replace md4 by md5 algorithm.
   */
  try {
    crypto.createHash('md4');
  } catch (e) {
    console.warn('Crypto "md4" is not supported Node versions > 16');
    const origCreateHash = crypto.createHash;
    crypto.createHash = (alg: any, opts: any) => {
      return origCreateHash(alg === 'md4' ? 'md5' : alg, opts);
    };
  }
}
