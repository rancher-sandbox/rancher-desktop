export const hexEncode = (str: string): string => Array.from(str)
  .map(c => `0${ c.charCodeAt(0).toString(16) }`.slice(-2))
  .join('');

export const hexDecode = (hexString: string): string | undefined => hexString.match(/.{1,2}/g)
  ?.map(hex => String.fromCharCode(parseInt(hex, 16)))
  .join('');
