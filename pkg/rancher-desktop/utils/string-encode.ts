export const hexEncode = (str: string): string => {
  let hex = '';

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i).toString(16);

    hex += charCode.length < 2 ? `0${ charCode }` : charCode;
  }

  return hex;
};
