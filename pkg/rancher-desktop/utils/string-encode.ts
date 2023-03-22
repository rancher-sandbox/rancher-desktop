export const hexEncode = (str: string): string => Array.from(str)
  .map(c => `0${ c.charCodeAt(0).toString(16) }`.slice(-2))
  .join('');
