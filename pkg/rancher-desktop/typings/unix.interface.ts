export interface UnixError {
  stdout:  string;
  stderr:  string;
  code:    string;
  message: string;
}

export const isUnixError = (val: any): val is UnixError => {
  return 'stdout' in val &&
    'stderr' in val &&
    'code' in val &&
    'message' in val;
};

export interface NodeError {
  syscall: string;
  path:    string;
  code:    string;
  message: string;
  errno:   number;
}

export const isNodeError = (val: any): val is NodeError => {
  return 'syscall' in val &&
    'path' in val &&
    'code' in val &&
    'message' in val;
};
