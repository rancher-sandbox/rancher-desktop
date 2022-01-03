export interface UnixError {
  stdout: string;
  stderr: string;
  code: string;
  message: string;
}

export const isUnixError = (val: any): val is UnixError => {
  return 'stdout' in val &&
    'stderr' in val &&
    'code' in val &&
    'message' in val;
};
