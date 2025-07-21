export function exec(cmd: string,
  options?: ((error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => void)
                | { name?: string, icns?: string, env?: Record<string, string> },
  callback?: (error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => void): void;
